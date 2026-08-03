import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const GRACE_DAYS = Number(process.env.GRACE_DAYS ?? 3);

@Injectable()
export class SubscriptionGateService {
  constructor(private prisma: PrismaService) {}

  /** Bina hizmet alabilir mi? (abonelik aktif/deneme veya grace icinde) */
  async canServeBuilding(buildingId: string): Promise<{ ok: boolean; message?: string }> {
    const building = await this.prisma.building.findUnique({
      where: { id: buildingId },
      select: { locationId: true },
    });
    // Lokasyona bagli degilse eski kayit -> engelleme
    if (!building?.locationId) return { ok: true };

    const sub = await this.prisma.subscription.findFirst({
      where: { locationId: building.locationId },
      orderBy: { createdAt: 'desc' },
    });
    // Abonelik hic yoksa engelleme (ilk erisimde olusuyor)
    if (!sub) return { ok: true };

    if (sub.status === 'active' && sub.monthlyPrice === 0) return { ok: true }; // superadmin ucretsiz

    const end = sub.status === 'trial' ? sub.trialEndsAt : sub.currentPeriodEnd;
    if (!end) return { ok: true };

    const deadline = new Date(new Date(end).getTime() + GRACE_DAYS * 24 * 60 * 60 * 1000);
    if (Date.now() <= deadline.getTime()) return { ok: true };

    return { ok: false, message: 'Bu binanin aboneligi sona ermis. Bina yonetimiyle iletisime geciniz.' };
  }

  async canServeApartment(apartmentId: string): Promise<{ ok: boolean; message?: string }> {
    const apt = await this.prisma.apartment.findUnique({
      where: { id: apartmentId },
      select: { buildingId: true },
    });
    if (!apt?.buildingId) return { ok: true };
    return this.canServeBuilding(apt.buildingId);
  }
}
