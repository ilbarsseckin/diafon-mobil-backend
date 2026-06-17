import {
  WebSocketGateway, WebSocketServer, SubscribeMessage,
  OnGatewayConnection, OnGatewayDisconnect, MessageBody, ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { PresenceService } from './presence.service';
import { PrismaService } from '../prisma/prisma.service';
import { Logger } from '@nestjs/common';

@WebSocketGateway({ cors: { origin: '*' } })
export class CallsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private logger = new Logger('CallsGateway');

  constructor(
    private jwt: JwtService,
    private presence: PresenceService,
    private prisma: PrismaService,
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
      await this.prisma.user.update({ where: { id: userId }, data: { isOnline: true } });
      this.logger.log(`Baglandi: user=${userId} socket=${client.id}`);
    } catch (e) {
      this.logger.warn(`Gecersiz token, baglanti reddedildi: ${e.message}`);
      client.disconnect();
    }
  }

  // --- Kopma: offline isaretle ---
  async handleDisconnect(client: Socket) {
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
    @MessageBody() data: { receiverUserId: string; buildingId?: string },
  ) {
    const callerUserId = client.data.userId;
    const receiverSocketId = await this.presence.getSocketId(data.receiverUserId);

    // Cagri kaydi olustur
    const call = await this.prisma.call.create({
      data: {
        callerUserId,
        receiverUserId: data.receiverUserId,
        buildingId: data.buildingId,
        status: 'RINGING',
      },
    });

    if (!receiverSocketId) {
      // Karsi taraf offline -> kacirildi
      await this.prisma.call.update({ where: { id: call.id }, data: { status: 'MISSED' } });
      client.emit('call:unavailable', { callId: call.id, message: 'Kullanıcı şu an çevrimdışı' });
      return;
    }

    const caller = await this.prisma.user.findUnique({
      where: { id: callerUserId },
      select: { id: true, name: true, photoUrl: true },
    });

    // Ev sahibine gelen cagri bildirimi
    this.server.to(receiverSocketId).emit('call:incoming', {
      callId: call.id,
      caller,
    });
    client.emit('call:ringing', { callId: call.id });
    this.logger.log(`Cagri: ${callerUserId} -> ${data.receiverUserId} (call=${call.id})`);
  }

  // --- Cagri kabul ---
  @SubscribeMessage('call:accept')
  async onCallAccept(@ConnectedSocket() client: Socket, @MessageBody() data: { callId: string }) {
    const call = await this.prisma.call.update({
      where: { id: data.callId },
      data: { status: 'ACCEPTED' },
    });
    const callerSocketId = await this.presence.getSocketId(call.callerUserId);
    if (callerSocketId) {
      this.server.to(callerSocketId).emit('call:accepted', { callId: call.id });
    }
  }

  // --- Cagri red ---
  @SubscribeMessage('call:reject')
  async onCallReject(@ConnectedSocket() client: Socket, @MessageBody() data: { callId: string }) {
    const call = await this.prisma.call.update({
      where: { id: data.callId },
      data: { status: 'REJECTED', endedAt: new Date() },
    });
    const callerSocketId = await this.presence.getSocketId(call.callerUserId);
    if (callerSocketId) {
      this.server.to(callerSocketId).emit('call:rejected', { callId: call.id });
    }
  }

  // --- Cagri bitir ---
  @SubscribeMessage('call:end')
  async onCallEnd(@ConnectedSocket() client: Socket, @MessageBody() data: { callId: string }) {
    const call = await this.prisma.call.findUnique({ where: { id: data.callId } });
    if (!call) return;
    const duration = call.startedAt ? Math.round((Date.now() - new Date(call.startedAt).getTime()) / 1000) : 0;
    await this.prisma.call.update({
      where: { id: data.callId },
      data: { status: 'ENDED', endedAt: new Date(), duration },
    });
    // Iki tarafa da bitti bildir
    for (const uid of [call.callerUserId, call.receiverUserId]) {
      const sid = await this.presence.getSocketId(uid);
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
