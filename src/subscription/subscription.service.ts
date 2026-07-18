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
    // Kullanicinin sahip oldugu LOKASYONLAR (her lokasyon = 1 abonelik)
    const locations = await this.prisma.location.findMany({
      where: { ownerUserId: userId },
      orderBy: { createdAt: 'asc' },
    });
    const isManager = locations.length > 0;
    const result: any[] = [];

    for (const loc of locations) {
      // Lokasyonun tum binalarindaki daire sayisi
      const locBuildings = await this.prisma.building.findMany({
        where: { locationId: loc.id },
        select: { id: true },
      });
      let flatCount = 0;
      for (const b of locBuildings) {
        flatCount += await this.prisma.apartment.count({ where: { buildingId: b.id } });
      }
      const planPrice = await this.planPriceForUnits(flatCount || 1);

      // Bu lokasyonun aboneligi
      let sub = await this.prisma.subscription.findFirst({
        where: { locationId: loc.id },
        orderBy: { createdAt: 'desc' },
      });

      // Yoksa 14 gunluk deneme baslat (her lokasyon kendi denemesini alir)
      if (!sub) {
        const trialEnd = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
        sub = await this.prisma.subscription.create({
          data: {
            ownerUserId: userId,
            locationId: loc.id,
            scopeType: loc.type === 'business' ? 'business' : 'site',
            scopeName: loc.name,
            status: 'trial',
            flatCount,
            monthlyPrice: planPrice,
            trialEndsAt: trialEnd,
            currentPeriodEnd: trialEnd,
          },
        });
      } else if (sub.flatCount !== flatCount) {
        // Daire sayisi degistiyse fiyati guncelle
        sub = await this.prisma.subscription.update({
          where: { id: sub.id },
          data: { flatCount, monthlyPrice: planPrice },
        });
      }

      const end = sub.status === 'trial' ? sub.trialEndsAt : sub.currentPeriodEnd;
      const left = this.daysLeft(end);
      let status = sub.status;
      if (left <= 0 && (status === 'trial' || status === 'active')) {
        status = 'expired';
        await this.prisma.subscription.update({ where: { id: sub.id }, data: { status: 'expired' } });
      }

      result.push({
        id: sub.id,
        label: loc.name,
        locationId: loc.id,
        scopeType: sub.scopeType,
        scopeName: loc.name,
        status,
        flatCount,
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
