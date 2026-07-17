import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Fiyatlandirma: daire basina hacim indirimli (TL/ay)
function pricePerFlat(count: number): number {
  if (count <= 20) return 15;
  if (count <= 60) return 13;
  if (count <= 150) return 11;
  return 9;
}

@Injectable()
export class SubscriptionService {
  constructor(private prisma: PrismaService) {}

  // Birim sayisina gore plan tablosundan aylik fiyat bul
  private async planPriceForUnits(unitCount: number): Promise<number> {
    const plan = await this.prisma.plan.findFirst({
      where: {
        isActive: true,
        minUnits: { lte: unitCount },
        OR: [{ maxUnits: null }, { maxUnits: { gte: unitCount } }],
      },
      orderBy: { minUnits: 'desc' },
    });
    return plan?.monthlyPrice ?? 0;
  }

  // Kalan gun hesabi
  private daysLeft(end: Date | null): number {
    if (!end) return 0;
    const ms = new Date(end).getTime() - Date.now();
    return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
  }

  // Yoneticinin tum abonelikleri + durum ozeti
  async mySubscriptions(userId: string) {
    // Yoneticinin sahip oldugu binalar -> site/bireysel gruplari
    const buildings = await this.prisma.building.findMany({ where: { ownerUserId: userId } });
    const isManager = buildings.length > 0;

    // Site bazli grupla (siteName varsa site, yoksa bireysel bina)
    const groups = new Map<string, { scopeType: string; scopeName: string; label: string; flatCount: number }>();
    for (const b of buildings) {
      const aptCount = await this.prisma.apartment.count({ where: { buildingId: b.id } });
      if (b.siteName) {
        const key = 'site:' + b.siteName;
        const g = groups.get(key) || { scopeType: 'site', scopeName: b.siteName, label: b.siteName, flatCount: 0 };
        g.flatCount += aptCount;
        groups.set(key, g);
      } else {
        const key = 'ind:' + b.id;
        groups.set(key, { scopeType: 'individual', scopeName: b.id, label: b.buildingName, flatCount: aptCount });
      }
    }

    const result: any[] = [];
    for (const g of groups.values()) {
      // Plan tablosundan aylik fiyat (birim sayisina gore)
      const planPrice = await this.planPriceForUnits(g.flatCount || 1);
      // Mevcut abonelik kaydi var mi?
      let sub = await this.prisma.subscription.findFirst({
        where: { ownerUserId: userId, scopeType: g.scopeType, scopeName: g.scopeName },
        orderBy: { createdAt: 'desc' },
      });
      // Yoksa abonelik baslat. Ama bu kullanici daha once deneme kullanmissa (expired/active gecmisi),
      // tekrar bedava deneme HAKKI YOK -> direkt odeme bekleyen durumda baslat.
      if (!sub) {
        const usedTrialBefore = await this.prisma.subscription.findFirst({
          where: {
            ownerUserId: userId,
            status: { in: ['expired', 'active', 'cancelled'] },
          },
        });
        const trialEnd = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
        sub = await this.prisma.subscription.create({
          data: {
            ownerUserId: userId,
            scopeType: g.scopeType,
            scopeName: g.scopeName,
            status: usedTrialBefore ? 'pending_payment' : 'trial',
            flatCount: g.flatCount,
            monthlyPrice: planPrice,
            trialEndsAt: usedTrialBefore ? new Date() : trialEnd,
            currentPeriodEnd: usedTrialBefore ? new Date() : trialEnd,
          },
        });
      } else if (sub.flatCount !== g.flatCount) {
        // Daire sayisi degistiyse fiyati guncelle
        sub = await this.prisma.subscription.update({
          where: { id: sub.id },
          data: {
            flatCount: g.flatCount,
            monthlyPrice: planPrice,
          },
        });
      }

      const end = sub.status === 'trial' ? sub.trialEndsAt : sub.currentPeriodEnd;
      const left = this.daysLeft(end);
      // Suresi dolmus mu kontrol
      let status = sub.status;
      if (left <= 0 && (status === 'trial' || status === 'active')) {
        status = 'expired';
        await this.prisma.subscription.update({ where: { id: sub.id }, data: { status: 'expired' } });
      }

      result.push({
        id: sub.id,
        label: g.label,
        scopeType: g.scopeType,
        scopeName: g.scopeName,
        status,
        flatCount: g.flatCount,
        monthlyPrice: sub.monthlyPrice,
        daysLeft: left,
        periodEnd: end,
        isTrial: sub.status === 'trial',
      });
    }
    // Arac (auto) aboneliklerini ekle
    const autoSubs = await this.prisma.subscription.findMany({
      where: { ownerUserId: userId, scopeType: 'auto' },
      orderBy: { createdAt: 'desc' },
    });
    for (const s of autoSubs) {
      const end = s.currentPeriodEnd;
      const left = this.daysLeft(end);
      let status = s.status;
      if (left <= 0 && status === 'active') {
        status = 'expired';
        await this.prisma.subscription.update({ where: { id: s.id }, data: { status: 'expired' } });
      }
      result.push({
        id: s.id,
        label: s.scopeName,
        scopeType: 'auto',
        scopeName: s.scopeName,
        status,
        flatCount: 0,
        monthlyPrice: s.monthlyPrice,
        daysLeft: left,
        periodEnd: end,
        isTrial: false,
      });
    }
    return { isManager, subscriptions: result };
  }
}
