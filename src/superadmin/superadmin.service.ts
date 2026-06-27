import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

function pricePerFlat(count: number): number {
  if (count <= 20) return 15;
  if (count <= 60) return 13;
  if (count <= 150) return 11;
  return 9;
}

@Injectable()
export class SuperadminService {
  constructor(private prisma: PrismaService) {}

  // Genel bakis: KPI + grafik verileri
  async overview() {
    const { customers } = await this.customers();
    const active = customers.filter((c: any) => c.status === 'active');
    const mrr = active.reduce((s: number, c: any) => s + c.mrr, 0);

    // Son 12 ay yeni kayit (signups) - User.createdAt'tan
    const now = new Date();
    const months: string[] = [];
    const signups: number[] = [];
    const revenue: number[] = [];
    const allUsers = await this.prisma.user.findMany({ select: { createdAt: true } });
    const monthNames = ['Oca','Sub','Mar','Nis','May','Haz','Tem','Agu','Eyl','Eki','Kas','Ara'];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const next = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      months.push(monthNames[d.getMonth()]);
      signups.push(allUsers.filter(u => u.createdAt >= d && u.createdAt < next).length);
      // Gelir: basit - su anki MRR'i son aya koy, oncekiler kademeli (gercek gecmis yok)
      revenue.push(i === 0 ? mrr / 1000 : 0);
    }

    // Plan dagilimi (scopeType bazli: site/bireysel) - subscription'lardan
    const subs = await this.prisma.subscription.findMany();
    const siteCount = subs.filter(s => s.scopeType === 'site').length;
    const indCount = subs.filter(s => s.scopeType === 'individual').length;

    return {
      kpi: {
        total: customers.length,
        active: active.length,
        trial: customers.filter((c: any) => c.status === 'trial').length,
        cancelled: customers.filter((c: any) => c.status === 'cancelled').length,
        mrr,
        buildings: customers.reduce((s: number, c: any) => s + c.buildings, 0),
        flats: customers.reduce((s: number, c: any) => s + c.flats, 0),
        calls: customers.reduce((s: number, c: any) => s + c.calls, 0),
      },
      months,
      signups,
      revenue,
      plans: { site: siteCount, individual: indCount },
    };
  }

  // Bir owner'in tum aboneliklerini ucretsiz (sinirsiz aktif) yap / geri al
  async setFree(ownerId: string, free: boolean) {
    if (!ownerId) return { success: false, message: 'ownerId gerekli' };
    if (free) {
      const farFuture = new Date('2099-12-31');
      await this.prisma.subscription.updateMany({
        where: { ownerUserId: ownerId },
        data: { status: 'active', monthlyPrice: 0, currentPeriodEnd: farFuture, trialEndsAt: farFuture },
      });
      await this.prisma.user.update({ where: { id: ownerId }, data: { isPremium: true } });
      return { success: true, message: 'Hesap ucretsiz (sinirsiz) yapildi' };
    } else {
      // Geri al: trial'a dondur (14 gun)
      const trialEnd = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
      await this.prisma.subscription.updateMany({
        where: { ownerUserId: ownerId },
        data: { status: 'trial', trialEndsAt: trialEnd, currentPeriodEnd: trialEnd },
      });
      return { success: true, message: 'Ucretsizlik kaldirildi' };
    }
  }

  // Tum musteriler (yoneticiler) + metrikleri
  async customers() {
    // Bina sahibi olan tum kullanicilar = musteriler
    const buildings = await this.prisma.building.findMany();
    const ownerIds = [...new Set(buildings.map(b => b.ownerUserId).filter(Boolean))] as string[];
    if (ownerIds.length === 0) return { customers: [] };

    const owners = await this.prisma.user.findMany({ where: { id: { in: ownerIds } } });
    const subs = await this.prisma.subscription.findMany({ where: { ownerUserId: { in: ownerIds } } });

    const customers: any[] = [];
    for (const owner of owners) {
      const ownerBuildings = buildings.filter(b => b.ownerUserId === owner.id);
      const buildingIds = ownerBuildings.map(b => b.id);
      const flatCount = await this.prisma.apartment.count({ where: { buildingId: { in: buildingIds } } });
      const residentCount = await this.prisma.resident.count({ where: { approved: true, apartment: { buildingId: { in: buildingIds } } } });
      const callCount = await this.prisma.call.count({ where: { buildingId: { in: buildingIds } } });

      // Bu owner'in abonelikleri -> MRR ve durum
      const ownerSubs = subs.filter(s => s.ownerUserId === owner.id);
      let mrr = 0;
      let status = 'trial';
      for (const s of ownerSubs) {
        if (s.status === 'active') { mrr += s.monthlyPrice; status = 'active'; }
        else if (s.status === 'trial' && status !== 'active') status = 'trial';
        else if (s.status === 'expired' && status === 'trial') status = 'cancelled';
      }
      // Hic abonelik yoksa deneme varsay
      if (ownerSubs.length === 0) status = 'trial';

      // Site adi (varsa) yoksa ilk bina adi
      const siteName = ownerBuildings.find(b => b.siteName)?.siteName || ownerBuildings[0]?.buildingName || 'Bilinmeyen';

      const isFree = ownerSubs.length > 0 && ownerSubs.every(s => s.status === 'active' && s.monthlyPrice === 0);
      customers.push({
        id: owner.id,
        name: siteName,
        owner: owner.name,
        phone: owner.phone,
        status,
        isFree,
        buildings: ownerBuildings.length,
        flats: flatCount,
        residents: residentCount,
        calls: callCount,
        mrr,
        since: owner.createdAt,
      });
    }
    return { customers };
  }
}
