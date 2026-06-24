import {
  WebSocketGateway, WebSocketServer, SubscribeMessage,
  OnGatewayConnection, OnGatewayDisconnect, MessageBody, ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { PresenceService } from './presence.service';
import { PushService } from './push.service';
import { PrismaService } from '../prisma/prisma.service';
import { Logger } from '@nestjs/common';

@WebSocketGateway({ cors: { origin: '*' } })
export class CallsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private logger = new Logger('CallsGateway');
  // Misafir cagrilari: callId -> { callerSocketId, callerUserId, receiverUserId }
  private guestCalls = new Map<string, { callerSocketId: string; callerUserId: string; receiverUserId: string }>();
  // Daire (grup) cagrilari: callId -> { tum alicilar, cevaplandi mi }
  private flatCallTargets = new Map<string, { receiverIds: string[]; answered: boolean; buildingId: string | null; apartmentId: string; guestName: string | null; callerUserId: string | null }>();

  constructor(
    private jwt: JwtService,
    private presence: PresenceService,
    private prisma: PrismaService,
    private push: PushService,
  ) {}

  // --- Baglanti: token dogrula, online isaretle ---
  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token || client.handshake.headers?.authorization?.replace('Bearer ', '');
      if (!token) {
        client.disconnect();
        return;
      }
      const payload = this.jwt.verify(token, { secret: process.env.JWT_SECRET || 'dev-secret' });
      const userId = payload.sub;
      client.data.userId = userId;

      await this.presence.setOnline(userId, client.id);
      if (payload.guest !== true) {
        await this.prisma.user.update({ where: { id: userId }, data: { isOnline: true } });
      }
      client.data.isGuest = payload.guest === true;
      client.data.guestName = payload.name || 'Ziyaretçi';
      this.logger.log(`Baglandi: user=${userId} socket=${client.id}`);
    } catch (e) {
      this.logger.warn(`Gecersiz token, baglanti reddedildi: ${e.message}`);
      client.disconnect();
    }
  }

  // --- Kopma: offline isaretle ---
  async handleDisconnect(client: Socket) {
    // Bu socket'in ACAYAN oldugu devam eden flatcall aramalari varsa, alicilara bitti+CallKit kapat
    for (const [callId, g] of this.guestCalls.entries()) {
      if (g.callerSocketId === client.id) {
        this.logger.log(`DISCONNECT temizlik: callId=${callId} alicilar=${this.flatCallTargets.get(callId)?.receiverIds?.length || 0}`);
        const flat = this.flatCallTargets.get(callId);
        if (flat && !flat.answered) {
          for (const uid of flat.receiverIds) {
            const sid = await this.presence.getSocketId(uid!);
            if (sid) {
              this.server.to(sid).emit('call:ended', { callId });
              this.server.to(sid).emit('call:taken', { callId });
            }
            await this.push.sendCallCancelled(uid, callId);
          }
        }
        this.guestCalls.delete(callId);
        this.flatCallTargets.delete(callId);
      }
    }
    const userId = await this.presence.setOffline(client.id);
    if (userId) {
      await this.prisma.user.update({ where: { id: userId }, data: { isOnline: false } }).catch(() => {});
      this.logger.log(`Koptu: user=${userId}`);
    }
  }

  // --- Cagri baslat: misafir -> ev sahibi ---
  @SubscribeMessage('call:start')
  async onCallStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { receiverUserId: string; buildingId?: string; callerPhotoUrl?: string },
  ) {
    const callerUserId = client.data.userId;
    const isGuest = client.data.isGuest === true;
    const receiverSocketId = await this.presence.getSocketId(data.receiverUserId);

    // Arayan bilgisi (misafir ise sabit Ziyaretci)
    let caller: any;
    if (isGuest) {
      caller = { id: callerUserId, name: client.data.guestName || 'Ziyaretçi', photoUrl: null };
    } else {
      caller = await this.prisma.user.findUnique({
        where: { id: callerUserId },
        select: { id: true, name: true, photoUrl: true },
      });
    }

    // Cagri kaydi (misafir ise DB'ye yazma, gecici callId)
    let callId: string;
    if (isGuest) {
      callId = 'guestcall_' + Math.random().toString(36).substring(2, 14);
    } else {
      const call = await this.prisma.call.create({
        data: {
          callerUserId,
          receiverUserId: data.receiverUserId,
          buildingId: data.buildingId,
          status: 'RINGING',
          callerPhotoUrl: data.callerPhotoUrl,
        },
      });
      callId = call.id;
    }

    // Misafir cagrisini bellekte takip et
    if (isGuest) {
      this.guestCalls.set(callId, {
        callerSocketId: client.id,
        callerUserId,
        receiverUserId: data.receiverUserId,
      });
    }

    if (!receiverSocketId) {
      // Karsi taraf offline -> push gonder
      await this.push.sendIncomingCall(data.receiverUserId, caller?.name || 'Birisi', callId, callerUserId, data.callerPhotoUrl);
      client.emit('call:ringing', { callId });
      return;
    }

    // Ev sahibine gelen cagri bildirimi
    this.server.to(receiverSocketId).emit('call:incoming', {
      callId,
      caller,
      callerPhoto: data.callerPhotoUrl || '',
    });
    client.emit('call:ringing', { callId });
    await this.push.sendIncomingCall(data.receiverUserId, caller?.name || 'Birisi', callId, callerUserId, data.callerPhotoUrl);
    this.logger.log(`Cagri: ${callerUserId} (guest=${isGuest}) -> ${data.receiverUserId} (call=${callId})`);
  }

  // --- Cagri kabul ---
  // --- Daire bazli cagri: dairedeki TUM sakinlere cal ---
  @SubscribeMessage('call:start-flat')
  async onCallStartFlat(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { apartmentId: string; lat?: number; lng?: number },
  ) {
    const callerUserId = client.data.userId;
    const isGuest = client.data.isGuest === true;

    if (isGuest) {
      const apt = await this.prisma.apartment.findUnique({
        where: { id: data.apartmentId },
        include: { building: { select: { latitude: true, longitude: true, locationCheckEnabled: true, locationCheckRadius: true } } },
      });
      const b = apt?.building;
      if (b && b.locationCheckEnabled) {
        if (typeof data.lat !== 'number' || typeof data.lng !== 'number') {
          client.emit('call:unavailable', { reason: 'Aramak icin konum izni gerekli' });
          return;
        }
        const R = 6371000;
        const toRad = (x: number) => (x * Math.PI) / 180;
        const dLat = toRad(data.lat - b.latitude);
        const dLng = toRad(data.lng - b.longitude);
        const aa = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(b.latitude)) * Math.cos(toRad(data.lat)) * Math.sin(dLng / 2) ** 2;
        const dist = R * 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa)); // Haversine
        if (dist > (b.locationCheckRadius || 150)) {
          client.emit('call:unavailable', { reason: 'Aramak icin binanin yakininda olmalisiniz' });
          return;
        }
      }
    }
    // Dairedeki tum sakinler
    const residents = await this.prisma.resident.findMany({
      where: { apartmentId: data.apartmentId, visible: true, approved: true, user: { blocked: false } },
      include: { user: { select: { id: true, name: true } } },
    });
    if (residents.length === 0) {
      client.emit('call:unavailable', { reason: 'Dairede sakin yok' });
      return;
    }

    // Dairenin binasi (kapi acma icin call:incoming'e eklenir)
    const flatApt = await this.prisma.apartment.findUnique({ where: { id: data.apartmentId }, select: { buildingId: true } });
    const flatBuildingId = flatApt?.buildingId || null;
    // Tek bir callId (grup cagrisi)
    const callId = 'flatcall_' + Math.random().toString(36).substring(2, 14);

    // Arayan bilgisi
    const caller = isGuest
      ? { id: callerUserId, name: client.data.guestName || 'Ziyaretçi', photoUrl: null }
      : await this.prisma.user.findUnique({ where: { id: callerUserId }, select: { id: true, name: true, photoUrl: true } });

    // Grup cagrisini bellekte takip et (ilk acan kazanir)
    this.guestCalls.set(callId, {
      callerSocketId: client.id,
      callerUserId,
      receiverUserId: residents[0].user.id, // ilk sakin (placeholder)
    });

    const receiverIds = residents.map(r => r.user.id);
    this.flatCallTargets.set(callId, { receiverIds, answered: false, buildingId: flatBuildingId, apartmentId: data.apartmentId, guestName: isGuest ? (client.data.guestName || 'Ziyaretçi') : null, callerUserId: isGuest ? null : callerUserId });

    // Tum sakinlere cagri gonder (online -> socket, offline -> push)
    for (const r of residents) {
      const sid = await this.presence.getSocketId(r.user.id);
      if (sid) {
        this.server.to(sid).emit('call:incoming', { callId, caller, callerPhoto: '', buildingId: flatBuildingId });
      }
      await this.push.sendIncomingCall(r.user.id, caller?.name || 'Ziyaretçi', callId, callerUserId, undefined, flatBuildingId || undefined);
    }

    client.emit('call:ringing', { callId });
    this.logger.log(`Daire cagrisi: ${callerUserId} -> daire ${data.apartmentId} (${receiverIds.length} kisi, call=${callId})`);

    // 30 sn timeout: cevap yoksa arayana bildir, cagriyi temizle
    const callerSocketIdForTimeout = client.id;
    setTimeout(() => {
      const flat = this.flatCallTargets.get(callId);
      if (flat && !flat.answered) {
        this.server.to(callerSocketIdForTimeout).emit('call:unavailable', { callId, reason: 'Cevap verilmedi' });
        // Calan sakinlere de durdur sinyali
        for (const uid of flat.receiverIds) {
          this.presence.getSocketId(uid).then(sid => {
            if (sid) this.server.to(sid).emit('call:taken', { callId });
          });
        }
        this.flatCallTargets.delete(callId);
        this.guestCalls.delete(callId);
      }
    }, 30000);
  }

  @SubscribeMessage('call:start-security')
  async onCallStartSecurity(@ConnectedSocket() client: Socket, @MessageBody() data: { apartmentId?: string }) {
    const callerUserId = client.data.userId;
    if (!callerUserId) { client.emit('call:unavailable', { reason: 'Yetkisiz' }); return; }
    // Sakinin binasini bul: apartmentId verildiyse ondan, yoksa sakinin ilk dairesinden
    let apt: any = null;
    if (data?.apartmentId) {
      apt = await this.prisma.apartment.findUnique({ where: { id: data.apartmentId }, include: { building: true } });
    } else {
      const res = await this.prisma.resident.findFirst({
        where: { userId: callerUserId, approved: true },
        include: { apartment: { include: { building: true } } },
      });
      apt = res?.apartment || null;
    }
    if (!apt || !apt.building || !apt.building.ownerUserId) {
      client.emit('call:unavailable', { reason: 'Guvenlik bulunamadi' });
      return;
    }
    // O binanin sahibinin guvenlikleri
    const guards = await this.prisma.securityGuard.findMany({ where: { ownerUserId: apt.building.ownerUserId } });
    if (guards.length === 0) { client.emit('call:unavailable', { reason: 'Guvenlik atanmamis' }); return; }
    // Guvenlik telefonlarindan kullanicilari bul
    const phones = guards.map(g => g.phone);
    const guardUsers = await this.prisma.user.findMany({ where: { phone: { in: phones }, blocked: false }, select: { id: true, name: true } });
    if (guardUsers.length === 0) { client.emit('call:unavailable', { reason: 'Guvenlik kullanicisi yok' }); return; }
    const callId = 'flatcall_' + Math.random().toString(36).substring(2, 14);
    const me = await this.prisma.user.findUnique({ where: { id: callerUserId }, select: { id: true, name: true, photoUrl: true } });
    const caller = { id: callerUserId, name: (me?.name || 'Sakin') + ' (Daire ' + (apt.flatNo || '-') + ')', photoUrl: me?.photoUrl || null };
    this.guestCalls.set(callId, { callerSocketId: client.id, callerUserId, receiverUserId: guardUsers[0].id });
    const receiverIds = guardUsers.map(u => u.id);
    this.flatCallTargets.set(callId, { receiverIds, answered: false, buildingId: null, apartmentId: '', guestName: null, callerUserId: client.data.userId || null });
    for (const gu of guardUsers) {
      const sid = await this.presence.getSocketId(gu.id);
      if (sid) this.server.to(sid).emit('call:incoming', { callId, caller, callerPhoto: caller.photoUrl || '' });
      await this.push.sendIncomingCall(gu.id, caller.name, callId, callerUserId, caller.photoUrl || undefined);
    }
    client.emit('call:ringing', { callId });
    this.logger.log(`Guvenlik cagrisi: ${callerUserId} -> ${receiverIds.length} guvenlik (call=${callId})`);
    const callerSocketIdForTimeout = client.id;
    setTimeout(() => {
      const flat = this.flatCallTargets.get(callId);
      if (flat && !flat.answered) {
        this.server.to(callerSocketIdForTimeout).emit('call:unavailable', { callId, reason: 'Guvenlik cevap vermedi' });
        for (const uid of flat.receiverIds) {
          this.presence.getSocketId(uid).then(sid => { if (sid) this.server.to(sid).emit('call:taken', { callId }); });
        }
        this.flatCallTargets.delete(callId);
        this.guestCalls.delete(callId);
      }
    }, 30000);
  }

  @SubscribeMessage('call:accept')
  async onCallAccept(@ConnectedSocket() client: Socket, @MessageBody() data: { callId: string }) {
    // Daire (grup) cagrisi: ilk acan kazanir, digerlerini sustur
    if (data.callId.startsWith('flatcall_')) {
      const flat = this.flatCallTargets.get(data.callId);
      const g = this.guestCalls.get(data.callId);
      if (!flat || flat.answered) {
        // Zaten baskasi acmis -> bu kisiye "alindi" de
        client.emit('call:taken', { callId: data.callId });
        return;
      }
      flat.answered = true;
      const accepterId = client.data.userId;
      // Cevaplandi -> DB'ye cagri kaydi yaz (istatistik icin)
      try {
        await this.prisma.call.create({
          data: {
            callerUserId: flat.callerUserId,
            guestName: flat.guestName,
            receiverUserId: accepterId,
            buildingId: flat.buildingId,
            apartmentId: flat.apartmentId,
            status: 'ACCEPTED',
          },
        });
      } catch (e) {
        this.logger.error('Flat cagri kaydedilemedi: ' + e);
      }
      // Arayana: kabul edildi (WebRTC baslasin), kabul eden kisiyle
      if (g) {
        this.server.to(g.callerSocketId).emit('call:accepted', { callId: data.callId, accepterId });
        // guestCalls'taki receiver'i guncelle (artik kabul eden kisi)
        g.receiverUserId = accepterId;
      }
      // Diger sakinlere: cagri baskasi tarafindan alindi
      for (const uid of flat.receiverIds) {
        if (uid === accepterId) continue;
        const sid = await this.presence.getSocketId(uid!);
        if (sid) this.server.to(sid).emit('call:taken', { callId: data.callId });
      }
      return;
    }

    // Misafir cagrisi: DB yok, Map'ten arayan socket'i bul
    if (data.callId.startsWith('guestcall_')) {
      const g = this.guestCalls.get(data.callId);
      if (g) {
        this.server.to(g.callerSocketId).emit('call:accepted', { callId: data.callId });
      }
      return;
    }
    const call = await this.prisma.call.update({
      where: { id: data.callId },
      data: { status: 'ACCEPTED' },
    });
    const callerSocketId = await this.presence.getSocketId(call.callerUserId!);
    if (callerSocketId) {
      this.server.to(callerSocketId).emit('call:accepted', { callId: call.id });
    }
  }

  // --- Cagri red ---
  @SubscribeMessage('call:reject')
  async onCallReject(@ConnectedSocket() client: Socket, @MessageBody() data: { callId: string }) {
    // Daire (grup) cagrisi: bir kisi reddederse cikar, HERKES reddederse arayana bildir
    if (data.callId.startsWith('flatcall_')) {
      const flat = this.flatCallTargets.get(data.callId);
      const g = this.guestCalls.get(data.callId);
      if (!flat || flat.answered) return; // zaten cevaplandi
      const rejecterId = client.data.userId;
      // Reddeden kisiyi listeden cikar
      flat.receiverIds = flat.receiverIds.filter(id => id !== rejecterId);
      // Kimse kalmadiysa -> arayana reddedildi
      if (flat.receiverIds.length === 0) {
        if (g) {
          this.server.to(g.callerSocketId).emit('call:rejected', { callId: data.callId });
        }
        this.flatCallTargets.delete(data.callId);
        this.guestCalls.delete(data.callId);
      }
      return;
    }

    if (data.callId.startsWith('guestcall_')) {
      const g = this.guestCalls.get(data.callId);
      if (g) {
        this.server.to(g.callerSocketId).emit('call:rejected', { callId: data.callId });
        this.guestCalls.delete(data.callId);
      }
      return;
    }
    const call = await this.prisma.call.update({
      where: { id: data.callId },
      data: { status: 'REJECTED', endedAt: new Date() },
    });
    const callerSocketId = await this.presence.getSocketId(call.callerUserId!);
    if (callerSocketId) {
      this.server.to(callerSocketId).emit('call:rejected', { callId: call.id });
    }
  }

  // --- Cagri bitir ---
  @SubscribeMessage('call:end')
  async onCallEnd(@ConnectedSocket() client: Socket, @MessageBody() data: { callId: string }) {
    // Daire (grup) cagrisi - flatcall: iki tarafa da bitti bildir
    if (data.callId.startsWith('flatcall_')) {
      const g = this.guestCalls.get(data.callId);
      const flat = this.flatCallTargets.get(data.callId);
      if (g) {
        this.server.to(g.callerSocketId).emit('call:ended', { callId: data.callId });
      }
      // TUM alicilara bitti + CallKit kapat (henuz cevaplamamis olanlar dahil)
      if (flat) {
        for (const uid of flat.receiverIds) {
          const sid = await this.presence.getSocketId(uid!);
          if (sid) {
            this.server.to(sid).emit('call:ended', { callId: data.callId });
            this.server.to(sid).emit('call:taken', { callId: data.callId });
          }
          await this.push.sendCallCancelled(uid, data.callId);
        }
      } else if (g) {
        const rsid = await this.presence.getSocketId(g.receiverUserId);
        if (rsid) {
          this.server.to(rsid).emit('call:ended', { callId: data.callId });
          this.server.to(rsid).emit('call:taken', { callId: data.callId });
        }
      }
      this.guestCalls.delete(data.callId);
      this.flatCallTargets.delete(data.callId);
      return;
    }
    if (data.callId.startsWith('guestcall_')) {
      const g = this.guestCalls.get(data.callId);
      if (g) {
        // Iki tarafa da bitti bildir
        this.server.to(g.callerSocketId).emit('call:ended', { callId: data.callId });
        const rsid = await this.presence.getSocketId(g.receiverUserId);
        if (rsid) this.server.to(rsid).emit('call:ended', { callId: data.callId });
        this.guestCalls.delete(data.callId);
      }
      return;
    }
    const call = await this.prisma.call.findUnique({ where: { id: data.callId } });
    if (!call) return;
    const duration = call.startedAt ? Math.round((Date.now() - new Date(call.startedAt).getTime()) / 1000) : 0;
    await this.prisma.call.update({
      where: { id: data.callId },
      data: { status: 'ENDED', endedAt: new Date(), duration },
    });
    for (const uid of [call.callerUserId, call.receiverUserId]) {
      const sid = await this.presence.getSocketId(uid!);
      if (sid) this.server.to(sid).emit('call:ended', { callId: call.id });
    }
  }

  // --- WebRTC sinyal iletimi (offer/answer/ice) ---
  @SubscribeMessage('webrtc:offer')
  async onOffer(@MessageBody() data: { toUserId: string; callId: string; sdp: any }) {
    const sid = await this.presence.getSocketId(data.toUserId);
    if (sid) this.server.to(sid).emit('webrtc:offer', { callId: data.callId, sdp: data.sdp });
  }

  @SubscribeMessage('webrtc:answer')
  async onAnswer(@MessageBody() data: { toUserId: string; callId: string; sdp: any }) {
    const sid = await this.presence.getSocketId(data.toUserId);
    if (sid) this.server.to(sid).emit('webrtc:answer', { callId: data.callId, sdp: data.sdp });
  }

  @SubscribeMessage('webrtc:ice')
  async onIce(@MessageBody() data: { toUserId: string; callId: string; candidate: any }) {
    const sid = await this.presence.getSocketId(data.toUserId);
    if (sid) this.server.to(sid).emit('webrtc:ice', { callId: data.callId, candidate: data.candidate });
  }
}
