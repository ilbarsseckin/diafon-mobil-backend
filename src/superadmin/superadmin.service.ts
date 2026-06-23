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

      customers.push({
        id: owner.id,
        name: siteName,
        owner: owner.name,
        phone: owner.phone,
        status,
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
