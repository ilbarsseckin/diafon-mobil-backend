import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBuildingDto } from './dto/building.dto';

@Injectable()
export class BuildingsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateBuildingDto) {
    return this.prisma.building.create({
      data: {
        buildingName: dto.buildingName,
        address: dto.address,
        latitude: dto.latitude,
        longitude: dto.longitude,
        radiusMeter: dto.radiusMeter ?? 30,
      },
    });
  }

  async findAll() {
    return this.prisma.building.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { apartments: true } } },
    });
  }

  async findOne(id: string) {
    const building = await this.prisma.building.findUnique({
      where: { id },
      include: { apartments: true },
    });
    if (!building) throw new NotFoundException('Bina bulunamadı');
    return building;
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.building.delete({ where: { id } });
    return { message: 'Bina silindi' };
  }

  /**
   * Kullanicinin konumuna gore, radius'una girdigi binayi bul.
   * PostGIS ile gercek metre cinsinden mesafe hesaplanir.
   * En yakin (ve radius icindeki) binayi dondurur.
   */
  async findByLocation(lat: number, lng: number) {
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT
        id, building_name, address, latitude, longitude, radius_meter,
        ST_Distance(
          ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography,
          ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography
        ) AS distance_meter
      FROM buildings
      WHERE ST_DWithin(
        ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography,
        ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
        radius_meter
      )
      ORDER BY distance_meter ASC
      LIMIT 1
    `;

    if (!rows || rows.length === 0) {
      return { found: false, message: 'Yakınınızda kayıtlı bina yok' };
    }

    const b = rows[0];
    // Binanin gorunur sakinlerini getir
    const residents = await this.prisma.resident.findMany({
      where: {
        visible: true,
        apartment: { buildingId: b.id },
        user: { blocked: false },
      },
      include: {
        user: { select: { id: true, name: true, photoUrl: true, isOnline: true } },
        apartment: { select: { flatNo: true, floor: true } },
      },
    });

    return {
      found: true,
      building: {
        id: b.id,
        buildingName: b.building_name,
        address: b.address,
        distanceMeter: Math.round(b.distance_meter),
      },
      residents: residents.map(r => ({
        userId: r.user.id,
        name: r.user.name,
        photoUrl: r.user.photoUrl,
        isOnline: r.user.isOnline,
        flatNo: r.apartment.flatNo,
        floor: r.apartment.floor,
      })),
    };
  }
}
