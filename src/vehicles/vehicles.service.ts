import { randomBytes, createHash } from 'crypto';
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
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

// Aktivasyon kodu havuzu icin DETERMINISTIK hash.
// bcrypt kullanilamaz: her seferinde farkli cikti verdigi icin
// "bu kod havuzda var mi" diye SORGULANAMAZ; 1000 satirla tek tek
// karsilastirmak gerekirdi (~100sn). sha256 index'lenir, tek sorgu.
// Kodlar yuksek entropili rastgele uretildigi icin bu yeterli.
function hashActivation(secretCode: string): string {
  const pepper = process.env.ACTIVATION_PEPPER;
  if (!pepper) throw new Error('ACTIVATION_PEPPER tanimli degil');
  return createHash('sha256')
    .update(secretCode.trim().toUpperCase() + pepper, 'utf8')
    .digest('hex');
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

  // Havuza yeni bir aktivasyon kodu ekler, duz metnini dondurur.
  private async yeniAktivasyonKodu(batchName: string): Promise<string> {
    for (let attempt = 0; attempt < 12; attempt++) {
      const candidate = randomFrom(ALPHABET, 8);
      const exists = await this.prisma.activationCode.findUnique({
        where: { codeHash: hashActivation(candidate) },
      });
      if (!exists) {
        await this.prisma.activationCode.create({
          data: { codeHash: hashActivation(candidate), batch: batchName },
        });
        return candidate;
      }
    }
    throw new BadRequestException('Aktivasyon kodu uretilemedi');
  }

  // SUPERADMIN: N adet QR + N adet aktivasyon kodu uretir.
  // IKISI BIRBIRINE BAGLI DEGILDIR. Hangi kagit hangi etiketle kutuya
  // girdigi onemsizdir. Duz kodlar SADECE burada, BIR KEZ doner.
  async generateBatch(count: number, batch?: string) {
    const n = Math.min(Math.max(Math.floor(count || 0), 1), 1000);
    const batchName = batch?.trim() || 'parti-' + new Date().toISOString().slice(0, 10);

    // A) QR havuzu
    const qrCodes: string[] = [];
    for (let i = 0; i < n; i++) {
      const code = await this.generateUniqueCode();
      await this.prisma.vehicle.create({
        data: { ownerUserId: null, code, secretCodeHash: null, status: 'unsold' },
      });
      qrCodes.push(code);
    }

    // B) Aktivasyon kodu havuzu (QR'lardan bagimsiz)
    const secrets: string[] = [];
    for (let i = 0; i < n; i++) {
      secrets.push(await this.yeniAktivasyonKodu(batchName));
    }

    return {
      count: n,
      batch: batchName,
      qrCodes,
      secrets,
      qrCsv: 'code\n' + qrCodes.join('\n'),
      secretCsv: 'secretCode\n' + secrets.join('\n'),
      warning: 'Aktivasyon kodlari BIR DAHA gosterilmez. Simdi kaydedin.',
    };
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
    // Abonelik suresi doldu mu?
    const sub = await this.prisma.subscription.findFirst({
      where: { vehicleId: vehicle.id },
      orderBy: { createdAt: 'desc' },
    });
    const bitis = sub?.currentPeriodEnd;
    const suresiVar = bitis ? new Date(bitis).getTime() > Date.now() : false;
    if (!suresiVar || sub?.status === 'cancelled' || sub?.status === 'expired') {
      return {
        found: false,
        expired: true,
        message: 'Bu QR kodun aboneligi sona ermis. Arac sahibiyseniz uygulamadan yenileyebilirsiniz.',
      };
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
    // Abonelik suresi kontrolu
    const rSub = await this.prisma.subscription.findFirst({
      where: { vehicleId: vehicle.id },
      orderBy: { createdAt: 'desc' },
    });
    const rBitis = rSub?.currentPeriodEnd;
    const rGecerli = rBitis ? new Date(rBitis).getTime() > Date.now() : false;
    if (!rGecerli || rSub?.status === 'cancelled' || rSub?.status === 'expired') {
      return { success: false, expired: true, message: 'Bu QR kodun aboneligi sona ermis' };
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

  // SUPERADMIN: havuza YENI bir aktivasyon kodu ekler.
  // ESKI ANLAMI DEGISTI: kod artik belirli bir karta ait olmadigi icin
  // "bu kartin kodunu sifirla" diye bir sey yok. Musteri kodunu
  // kaybettiyse buradan yeni kod uretip verirsin.
  async issueActivationCode(batch?: string) {
    const batchName = batch?.trim() || 'destek-' + new Date().toISOString().slice(0, 10);
    const secretCode = await this.yeniAktivasyonKodu(batchName);
    return {
      success: true,
      secretCode, // duz metin, BIR KEZ
      batch: batchName,
      message: 'Yeni aktivasyon kodu uretildi. Bir daha gosterilmez.',
    };
  }

  // Aktivasyon: QR + havuzdan HERHANGI bir kullanilmamis kod + e-posta.
  // Kod ile QR arasinda onceden bir bag YOKTUR; bag burada kurulur.
  async activate(
    userId: string,
    code: string,
    secretCode: string,
    email?: string,
    label?: string,
    plate?: string,
  ) {
    const vehicle = await this.prisma.vehicle.findUnique({ where: { code } });
    if (!vehicle) throw new NotFoundException('Arac bulunamadi');
    if (vehicle.status === 'burned') {
      throw new BadRequestException('Bu kart iptal edilmis, kullanilamaz');
    }
    if (vehicle.ownerUserId || vehicle.status === 'active') {
      throw new BadRequestException('Bu kart zaten aktive edilmis');
    }

    const codeHash = hashActivation(secretCode);
    const act = await this.prisma.activationCode.findUnique({ where: { codeHash } });
    if (!act) throw new BadRequestException('Gizli kod hatali');
    if (act.used) throw new BadRequestException('Bu kod daha once kullanilmis');

    const cleanEmail = email?.trim().toLowerCase() || null;

    return this.prisma.$transaction(async (tx) => {
      // Kodu KOSULLU sahiplen. Iki istek ayni anda gelirse sadece biri
      // count=1 alir, digeri 0 -> yaris durumu veritabaninda cozulur.
      const claimed = await tx.activationCode.updateMany({
        where: { codeHash, used: false },
        data: {
          used: true,
          usedVehicleId: vehicle.id,
          usedUserId: userId,
          usedAt: new Date(),
        },
      });
      if (claimed.count === 0) {
        throw new BadRequestException('Bu kod daha once kullanilmis');
      }

      // Araci da KOSULLU sahiplen
      const vClaimed = await tx.vehicle.updateMany({
        where: { id: vehicle.id, ownerUserId: null },
        data: {
          ownerUserId: userId,
          label: label?.trim() || vehicle.label || null,
          plate: plate?.trim() || vehicle.plate || null,
          status: 'active',
        },
      });
      if (vClaimed.count === 0) {
        throw new BadRequestException('Bu kart zaten aktive edilmis');
      }

      const updated: any = await tx.vehicle.findUnique({ where: { id: vehicle.id } });

      // E-posta: hesapta yoksa yaz. Numara degisirse kurtarma kanali bu.
      if (cleanEmail) {
        const user: any = await tx.user.findUnique({ where: { id: userId } });
        if (user && !user.email) {
          await tx.user.update({
            where: { id: userId },
            data: { email: cleanEmail, emailVerified: false },
          });
        }
      }

      const scopeName = updated.label || updated.plate || updated.code;

      // Idempotent: bu arac icin auto aboneligi zaten var mi?
      let sub: any = await tx.subscription.findFirst({
        where: { ownerUserId: userId, scopeType: 'auto', vehicleId: updated.id },
        orderBy: { createdAt: 'desc' },
      });
      if (!sub) {
        const periodEnd = new Date(Date.now() + AUTO_SUBSCRIPTION_DAYS * 24 * 60 * 60 * 1000);
        sub = await tx.subscription.create({
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
        vehicle: {
          id: updated.id, label: updated.label, plate: updated.plate,
          code: updated.code, status: updated.status,
        },
        subscription: {
          id: sub.id, status: sub.status, currentPeriodEnd: sub.currentPeriodEnd,
        },
      };
    });
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

  // SUPERADMIN: etiket basimi icin satilmamis QR kodlari.
  // Artik gizli kod ile bagli olmadigi icin etiket ISTEDIGIN ZAMAN basilabilir.
  async getUnsoldCodes(): Promise<{ code: string }[]> {
    const vehicles = await this.prisma.vehicle.findMany({
      where: { status: 'unsold' },
      select: { code: true },
      orderBy: { createdAt: 'desc' },
    });
    return vehicles;
  }

  // SUPERADMIN: aktivasyon kodu havuzunun durumu
  async activationPoolStatus() {
    const total = await this.prisma.activationCode.count();
    const used = await this.prisma.activationCode.count({ where: { used: true } });
    return { total, used, available: total - used };
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
