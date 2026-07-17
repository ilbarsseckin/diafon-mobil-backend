import { randomBytes } from 'crypto';
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from '../calls/push.service';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const AUTO_SUBSCRIPTION_DAYS = 365; // kart 1 yillik pesin

function randomFrom(alphabet: string, len: number): string {
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

@Injectable()
export class VehiclesService {
  constructor(private prisma: PrismaService, private push: PushService) {}

  private async generateUniqueCode(): Promise<string> {
    for (let attempt = 0; attempt < 12; attempt++) {
      const code = 'AUTO-' + randomFrom(ALPHABET, 6);
      const existing = await this.prisma.vehicle.findUnique({ where: { code } });
      if (!existing) return code;
    }
    throw new BadRequestException('Kod uretilemedi, tekrar deneyin');
  }

  // SUPERADMIN: N adet sahipsiz kart uret. secretCode'lar duz metin BIR KEZ doner.
  async generateBatch(count: number) {
    const n = Math.min(Math.max(Math.floor(count || 0), 1), 500);
    const cards: { code: string; secretCode: string }[] = [];
    for (let i = 0; i < n; i++) {
      const code = await this.generateUniqueCode();
      const secretCode = randomFrom(ALPHABET, 8);
      const secretCodeHash = await bcrypt.hash(secretCode, 10);
      await this.prisma.vehicle.create({
        data: { ownerUserId: null, code, secretCodeHash, status: 'unsold' },
      });
      cards.push({ code, secretCode });
    }
    const csv = 'code,secretCode\n' + cards.map(c => c.code + ',' + c.secretCode).join('\n');
    return { count: n, cards, csv };
  }

  async findMine(userId: string) {
    const vehicles = await this.prisma.vehicle.findMany({
      where: { ownerUserId: userId },
      orderBy: { createdAt: 'desc' },
    });
    return vehicles.map(v => ({
      id: v.id, label: v.label, plate: v.plate, code: v.code, status: v.status, activeMessage: v.activeMessage, createdAt: v.createdAt,
    }));
  }

  // Camdaki QR (code) ile bilgi. Sadece ARAMA -> KATILIM YOK.
  async lookupByCode(code: string) {
    const vehicle = await this.prisma.vehicle.findUnique({ where: { code } });
    if (!vehicle) return { found: false, message: 'Arac bulunamadi' };
    if (vehicle.status === 'unsold' || !vehicle.ownerUserId) {
      return { found: false, message: 'Bu kart henuz aktive edilmemis' };
    }
    if (vehicle.status === 'passive') {
      return { found: false, message: 'Arac sahibi su an ulasilamiyor (gecici olarak kapali)' };
    }
    if (vehicle.status !== 'active') {
      return { found: false, message: 'Arac aktif degil' };
    }
    const owner = await this.prisma.user.findUnique({
      where: { id: vehicle.ownerUserId },
      select: { id: true, name: true, photoUrl: true, isOnline: true },
    });
    return {
      found: true,
      canCall: true,
      canJoin: false,
      vehicle: { id: vehicle.id, label: vehicle.label },
      activeMessage: vehicle.activeMessage || null,
      owner: owner ? { userId: owner.id, name: owner.name, photoUrl: owner.photoUrl, isOnline: owner.isOnline } : null,
    };
  }

  // Sahip aracinin aktif mesajini ayarlar/kaldirir
  async setMessage(userId: string, vehicleId: string, message: string | null) {
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id: vehicleId } });
    if (!vehicle) throw new NotFoundException('Arac bulunamadi');
    if (vehicle.ownerUserId !== userId) throw new BadRequestException('Bu araca mesaj ayarlama yetkiniz yok');
    const msg = (message || '').trim();
    const updated = await this.prisma.vehicle.update({
      where: { id: vehicleId },
      data: { activeMessage: msg.length > 0 ? msg.substring(0, 200) : null },
    });
    return { success: true, activeMessage: updated.activeMessage };
  }

  // QR okutan zil calar -> arac sahibine push bildirim
  async ringVehicle(code: string) {
    const vehicle = await this.prisma.vehicle.findUnique({ where: { code } });
    if (!vehicle || vehicle.status !== 'active' || !vehicle.ownerUserId) {
      return { success: false, message: 'Arac bulunamadi' };
    }
    const links = await this.prisma.vehicleUser.findMany({ where: { vehicleId: vehicle.id }, select: { userId: true } });
    const targetIds = [...new Set([vehicle.ownerUserId, ...links.map(l => l.userId)])] as string[];
    try {
      await this.push.sendNoteNotification(
        targetIds,
        'Aracinizin basina gidin',
        'Biri aracinizin QR kodunu okuttu ve zil caldi.',
      );
    } catch (e) {
      // push basarisiz olsa da islem basarili sayilir
    }
    return { success: true, message: 'Arac sahibine bildirim gonderildi' };
  }

  // SUPERADMIN: kartin gizli kodunu sifirla, yeni kodu bir kez dondur
  async resetSecretCode(code: string) {
    const vehicle = await this.prisma.vehicle.findUnique({ where: { code } });
    if (!vehicle) return { success: false, message: 'Kart bulunamadi' };
    const secretCode = randomFrom(ALPHABET, 8);
    const secretCodeHash = await bcrypt.hash(secretCode, 10);
    await this.prisma.vehicle.update({
      where: { id: vehicle.id },
      data: { secretCodeHash },
    });
    return {
      success: true,
      code: vehicle.code,
      secretCode, // duz metin, bir kez
      message: 'Gizli kod sifirlandi. Yeni kodu musteriye verin.',
    };
  }

  // Gizli kod ile aktivasyon: aracı aktive edene baglar + 1 yillik auto aboneligi acar.
  async activate(userId: string, code: string, secretCode: string, label?: string, plate?: string) {
    const vehicle = await this.prisma.vehicle.findUnique({ where: { code } });
    if (!vehicle) throw new NotFoundException('Arac bulunamadi');
    if (vehicle.ownerUserId || vehicle.status === 'active') {
      throw new BadRequestException('Bu kart zaten aktive edilmis');
    }
    const ok = await bcrypt.compare(secretCode, vehicle.secretCodeHash);
    if (!ok) throw new BadRequestException('Gizli kod hatali');

    // Araci aktive edene bagla
    const updated = await this.prisma.vehicle.update({
      where: { id: vehicle.id },
      data: {
        ownerUserId: userId,
        label: label?.trim() || vehicle.label || null,
        plate: plate?.trim() || vehicle.plate || null,
        status: 'active',
      },
    });

    const scopeName = updated.label || updated.plate || updated.code;

    // Idempotent: bu arac icin auto aboneligi zaten var mi?
    let sub = await this.prisma.subscription.findFirst({
      where: { ownerUserId: userId, scopeType: 'auto', vehicleId: updated.id },
      orderBy: { createdAt: 'desc' },
    });
    if (!sub) {
      const periodEnd = new Date(Date.now() + AUTO_SUBSCRIPTION_DAYS * 24 * 60 * 60 * 1000);
      sub = await this.prisma.subscription.create({
        data: {
          ownerUserId: userId,
          scopeType: 'auto',
          scopeName,
          vehicleId: updated.id,
          status: 'active',
          flatCount: 0,
          monthlyPrice: 0, // kart alinirken 1 yillik pesin odendi
          currentPeriodEnd: periodEnd,
        },
      });
    }

    return {
      success: true,
      message: 'Arac aktive edildi',
      vehicle: { id: updated.id, label: updated.label, plate: updated.plate, code: updated.code, status: updated.status },
      subscription: { id: sub.id, status: sub.status, currentPeriodEnd: sub.currentPeriodEnd },
    };
  }

  async setVehicleActive(userId: string, id: string, active: boolean) {
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id } });
    if (!vehicle) throw new NotFoundException('Arac bulunamadi');
    if (vehicle.ownerUserId !== userId) throw new BadRequestException('Bu araca islem yetkiniz yok');
    const updated = await this.prisma.vehicle.update({
      where: { id },
      data: { status: active ? 'active' : 'passive' },
    });
    return { success: true, status: updated.status };
  }

  async remove(userId: string, id: string) {
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id } });
    if (!vehicle) throw new NotFoundException('Arac bulunamadi');
    if (vehicle.ownerUserId !== userId) throw new BadRequestException('Bu araci silme yetkiniz yok');
    await this.prisma.vehicle.delete({ where: { id } });
    return { message: 'Arac silindi' };
  }

  // SUPERADMIN: etiket icin kart bilgisi. NOT: secretCode hash'li saklandigindan
  // mevcut kartlarin duz gizli kodu YOKTUR. Bu yuzden etiket ancak URETIM aninda
  // (duz kodlar eldeyken) basilabilir. Stok icin: gizli kodu sifirlayip yeni kod uret.
  async getUnsoldCodes(): Promise<{ code: string }[]> {
    const vehicles = await this.prisma.vehicle.findMany({
      where: { status: 'unsold' },
      select: { code: true },
      orderBy: { createdAt: 'desc' },
    });
    return vehicles;
  }

  // SUPERADMIN: tum kartlar + ozet
  async vehiclesOverview() {
    const vehicles = await this.prisma.vehicle.findMany({ orderBy: { createdAt: 'desc' } });
    const ownerIds = [...new Set(vehicles.map(v => v.ownerUserId).filter(Boolean))] as string[];
    const owners = ownerIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true, phone: true } })
      : [];
    const subs = await this.prisma.subscription.findMany({ where: { scopeType: 'auto' } });
    const ownerMap = new Map(owners.map(o => [o.id, o]));
    const now = Date.now();

    const list = vehicles.map(v => {
      const owner = v.ownerUserId ? ownerMap.get(v.ownerUserId) : null;
      const sub = subs.find(s => s.vehicleId === v.id);
      let daysLeft: number | null = null;
      if (sub?.currentPeriodEnd) {
        daysLeft = Math.max(0, Math.ceil((new Date(sub.currentPeriodEnd).getTime() - now) / 86400000));
      }
      return {
        id: v.id,
        code: v.code,
        label: v.label,
        plate: v.plate,
        status: v.status,
        ownerName: owner?.name || null,
        ownerPhone: owner?.phone || null,
        createdAt: v.createdAt,
        subscriptionEnd: sub?.currentPeriodEnd || null,
        subscriptionStatus: sub?.status || null,
        daysLeft,
      };
    });

    const produced = vehicles.length;
    const sold = vehicles.filter(v => v.status === 'active').length;
    const unsold = vehicles.filter(v => v.status === 'unsold').length;
    const activeSubs = subs.filter(s => s.status === 'active').length;

    return { summary: { produced, sold, unsold, activeSubs }, vehicles: list };
  }

  // --- Ikincil kullanicilar (es vb.) ---

  // Sahip, telefon no ile ikincil kullanici ekler
  async addVehicleUser(ownerId: string, vehicleId: string, phone: string) {
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id: vehicleId } });
    if (!vehicle) throw new NotFoundException('Arac bulunamadi');
    if (vehicle.ownerUserId !== ownerId) throw new BadRequestException('Sadece arac sahibi kisi ekleyebilir');
    const clean = (phone || '').trim();
    if (!clean) throw new BadRequestException('Telefon numarasi gerekli');
    const user = await this.prisma.user.findUnique({ where: { phone: clean } });
    if (!user) throw new NotFoundException('Bu numarayla kayitli kullanici bulunamadi');
    if (user.id === vehicle.ownerUserId) throw new BadRequestException('Sahip zaten araca bagli');
    const exists = await this.prisma.vehicleUser.findUnique({ where: { vehicleId_userId: { vehicleId, userId: user.id } } });
    if (exists) throw new BadRequestException('Bu kisi zaten ekli');
    await this.prisma.vehicleUser.create({ data: { vehicleId, userId: user.id, role: 'secondary' } });
    return { success: true, user: { userId: user.id, name: user.name, phone: user.phone } };
  }

  // Sahip, ikincil kullaniciyi cikarir
  async removeVehicleUser(ownerId: string, vehicleId: string, userId: string) {
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id: vehicleId } });
    if (!vehicle) throw new NotFoundException('Arac bulunamadi');
    if (vehicle.ownerUserId !== ownerId) throw new BadRequestException('Sadece arac sahibi kisi cikarabilir');
    await this.prisma.vehicleUser.deleteMany({ where: { vehicleId, userId } });
    return { success: true };
  }

  // Araca bagli ikincil kullanicilari listeler (sahip gorur)
  async listVehicleUsers(ownerId: string, vehicleId: string) {
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id: vehicleId } });
    if (!vehicle) throw new NotFoundException('Arac bulunamadi');
    if (vehicle.ownerUserId !== ownerId) throw new BadRequestException('Yetkiniz yok');
    const links = await this.prisma.vehicleUser.findMany({
      where: { vehicleId },
      include: { user: { select: { id: true, name: true, phone: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return { users: links.map(l => ({ userId: l.user.id, name: l.user.name, phone: l.user.phone, role: l.role })) };
  }

}
