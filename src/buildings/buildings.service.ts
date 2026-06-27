import { randomUUID } from 'crypto';
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
        id, building_name, address, site_name, block_name, latitude, longitude, radius_meter,
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
        approved: true,
        apartment: { buildingId: b.id },
        user: { blocked: false },
      },
      include: {
        user: { select: { id: true, name: true, photoUrl: true, isOnline: true } },
        apartment: { select: { id: true, flatNo: true, floor: true, listingStatus: true } },
      },
    });

    let blocks: any[] = [];
    if (b.site_name) {
      const siblings = await this.prisma.building.findMany({
        where: { siteName: b.site_name },
        select: { id: true, buildingName: true, blockName: true, qrToken: true },
        orderBy: { blockName: 'asc' },
      });
      for (const blk of siblings) {
        const cnt = await this.prisma.resident.count({
          where: { approved: true, visible: true, user: { blocked: false }, apartment: { buildingId: blk.id } },
        });
        blocks.push({
          buildingId: blk.id,
          buildingName: blk.buildingName,
          blockName: blk.blockName,
          qrToken: blk.qrToken,
          residentCount: cnt,
        });
      }
    }
    return {
      found: true,
      isSite: !!b.site_name,
      siteName: b.site_name || null,
      blocks,
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
        apartmentId: r.apartment.id,
        flatNo: r.apartment.flatNo,
        floor: r.apartment.floor,
        listingStatus: r.apartment.listingStatus,
      })),
    };
  }

  /**
   * Sakin kayit: konuma yakin bina varsa ona katil, yoksa yeni olustur.
   * Sonra kullanicinin dairesini ekler ve RESIDENT yapar.
   */
  async joinOrCreate(userId: string, dto: {
    buildingName: string; address?: string;
    latitude: number; longitude: number;
    flatNo: string; floor?: string;
  }) {
    // 1. Yakinda (30m) bina var mi?
    const near = await this.prisma.$queryRaw<any[]>`
      SELECT id, building_name
      FROM buildings
      WHERE ST_DWithin(
        ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography,
        ST_SetSRID(ST_MakePoint(${dto.longitude}, ${dto.latitude}), 4326)::geography,
        30
      )
      ORDER BY ST_Distance(
        ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography,
        ST_SetSRID(ST_MakePoint(${dto.longitude}, ${dto.latitude}), 4326)::geography
      ) ASC
      LIMIT 1
    `;

    let buildingId: string;
    let joined = false;

    if (near && near.length > 0) {
      // Bina zaten var -> katil
      buildingId = near[0].id;
      joined = true;
    } else {
      // Yeni bina olustur (otomatik QR token ile)
      const newToken = 'DIAFON-' + randomUUID().replace(/-/g, '');
      // Kurucu premium mi? Premium ise yonetici olur + onay sistemi acilir
      const creator = await this.prisma.user.findUnique({ where: { id: userId }, select: { isPremium: true } });
      const isPremiumCreator = creator?.isPremium === true;
      const b = await this.prisma.building.create({
        data: {
          buildingName: dto.buildingName,
          address: dto.address,
          latitude: dto.latitude,
          longitude: dto.longitude,
          radiusMeter: 100,
          qrToken: newToken,
          ownerUserId: isPremiumCreator ? userId : null,
          requireApproval: isPremiumCreator,
        },
      });
      buildingId = b.id;
    }

    // 2. Daire var mi, yoksa olustur
    let apartment = await this.prisma.apartment.findFirst({
      where: { buildingId, flatNo: dto.flatNo },
    });
    if (!apartment) {
      apartment = await this.prisma.apartment.create({
        data: { buildingId, flatNo: dto.flatNo, floor: dto.floor, qrToken: require('crypto').randomBytes(16).toString('hex') },
      });
    }

    // 3. Kullaniciyi bu daireye sakin yap (zaten varsa tekrar ekleme)
    const bldForApproval = await this.prisma.building.findUnique({ where: { id: buildingId }, select: { requireApproval: true, ownerUserId: true } });
    // Kurucu/yonetici onaydan muaf; baskasinin yoneticili binasina katilan beklemede
    const isOwner = bldForApproval?.ownerUserId === userId;
    const needsApproval = bldForApproval?.requireApproval === true && !isOwner && !joined === false;
    // Aciklama: yeni bina kuran (joined=false) zaten owner olur -> isOwner true -> needsApproval false
    const finalNeedsApproval = bldForApproval?.requireApproval === true && !isOwner;
    const existing = await this.prisma.resident.findFirst({
      where: { userId, apartmentId: apartment.id },
    });
    if (!existing) {
      await this.prisma.resident.create({
        data: { userId, apartmentId: apartment.id, visible: true, approved: !finalNeedsApproval },
      });
    }

    // 4. Kullaniciyi RESIDENT rolune yukselt
    await this.prisma.user.update({
      where: { id: userId },
      data: { role: 'RESIDENT' },
    });

    const building = await this.prisma.building.findUnique({ where: { id: buildingId } });
    return {
      joined,
      message: joined ? 'Var olan binaya katildiniz' : 'Yeni bina olusturuldu',
      building: {
        id: building!.id,
        buildingName: building!.buildingName,
        address: building!.address,
      },
      flatNo: dto.flatNo,
    };
  }

  /**
   * QR token ile bina bul + sakin listesi dondur.
   */
  async findByQrToken(qrToken: string) {
    const building = await this.prisma.building.findUnique({
      where: { qrToken },
    });
    if (!building) {
      return { found: false, message: 'Geçersiz QR kod' };
    }
    const residents = await this.prisma.resident.findMany({
      where: {
        visible: true,
        approved: true,
        apartment: { buildingId: building.id },
        user: { blocked: false },
      },
      include: {
        user: { select: { id: true, name: true, photoUrl: true, isOnline: true } },
        apartment: { select: { id: true, flatNo: true, floor: true, listingStatus: true } },
      },
    });
    // Bu bina bir siteye aitse, kardes bloklari da getir
    let blocks: any[] = [];
    if (building.siteName) {
      const siblingBlocks = await this.prisma.building.findMany({
        where: { siteName: building.siteName },
        select: { id: true, buildingName: true, blockName: true, qrToken: true },
        orderBy: { blockName: 'asc' },
      });
      // Her blok icin sakin sayisi
      for (const blk of siblingBlocks) {
        const cnt = await this.prisma.resident.count({
          where: { approved: true, visible: true, user: { blocked: false }, apartment: { buildingId: blk.id } },
        });
        blocks.push({
          buildingId: blk.id,
          buildingName: blk.buildingName,
          blockName: blk.blockName,
          qrToken: blk.qrToken,
          residentCount: cnt,
        });
      }
    }

    // Bu binanin sahibine ait guvenlik gorevlileri (sadece uygulamaya kayitli/aranabilir olanlar)
    const guardRecords = building.ownerUserId
      ? await this.prisma.securityGuard.findMany({
          where: { ownerUserId: building.ownerUserId },
        })
      : [];
    const guardPhones = guardRecords.map(g => g.phone);
    const guardUsers = guardPhones.length
      ? await this.prisma.user.findMany({
          where: { phone: { in: guardPhones }, blocked: false },
          select: { id: true, name: true, phone: true, photoUrl: true, isOnline: true },
        })
      : [];
    const guards = guardUsers.map(u => {
      const rec = guardRecords.find(g => g.phone === u.phone);
      return {
        userId: u.id,
        name: rec?.guardName || u.name || 'Guvenlik',
        photoUrl: u.photoUrl,
        isOnline: u.isOnline,
      };
    });

    return {
      found: true,
      isSite: !!building.siteName,
      siteName: building.siteName || null,
      blocks,
      guards,
      building: {
        id: building.id,
        buildingName: building.buildingName,
        address: building.address,
        imageUrl: building.imageUrl,
      },
      residents: residents.map(r => ({
        userId: r.user.id,
        name: r.user.name,
        photoUrl: r.user.photoUrl,
        isOnline: r.user.isOnline,
        apartmentId: r.apartment.id,
        flatNo: r.apartment.flatNo,
        floor: r.apartment.floor,
        listingStatus: r.apartment.listingStatus,
      })),
    };
  }

  /**
   * QR token ile binaya sakin olarak katil.
   */
  async joinByQr(userId: string, qrToken: string, flatNo: string, floor?: string) {
    const building = await this.prisma.building.findUnique({ where: { qrToken } });
    if (!building) {
      return { success: false, message: 'Geçersiz QR kod' };
    }

    // Daire var mi, yoksa olustur
    let apartment = await this.prisma.apartment.findFirst({
      where: { buildingId: building.id, flatNo },
    });
    if (!apartment) {
      // Yoneticili binada olmayan daireye katilim YOK (yonetici yapiyi kurdu)
      if (building.requireApproval && !apartment) {
        return { success: false, message: 'Bu binada böyle bir daire yok. Yöneticinin tanımladığı daireyi seçin.' };
      }
      apartment = await this.prisma.apartment.create({
        data: { buildingId: building.id, flatNo, floor },
      });
    }

    // Sakin yap (zaten varsa tekrar ekleme)
    const needsApprovalQr = building.requireApproval === true;
    const existing = await this.prisma.resident.findFirst({
      where: { userId, apartmentId: apartment.id },
    });
    if (!existing) {
      await this.prisma.resident.create({
        data: { userId, apartmentId: apartment.id, visible: true, approved: !needsApprovalQr },
      });
    }

    await this.prisma.user.update({ where: { id: userId }, data: { role: 'RESIDENT' } });

    return {
      success: true,
      message: building.buildingName + ' binasina katildiniz',
      building: { id: building.id, buildingName: building.buildingName },
      flatNo,
    };
  }
  // Web'den public katilim: telefon ile kullanici olustur/bul, daireye onaysiz bagla
  async webJoin(dto: { buildingId: string; flatNo: string; name?: string; phone: string }) {
    const phone = dto.phone.replace(/\s/g, '');
    if (!/^0?5\d{9}$/.test(phone)) {
      return { success: false, message: 'Geçerli bir telefon numarası girin.' };
    }
    const building = await this.prisma.building.findUnique({ where: { id: dto.buildingId } });
    if (!building) {
      return { success: false, message: 'Bina bulunamadı.' };
    }
    // Daire var mi, yoksa olustur
    let apartment = await this.prisma.apartment.findFirst({
      where: { buildingId: building.id, flatNo: dto.flatNo },
    });
    if (!apartment) {
      apartment = await this.prisma.apartment.create({
        data: { buildingId: building.id, flatNo: dto.flatNo, qrToken: require('crypto').randomBytes(16).toString('hex') },
      });
    }
    // Telefonla kullanici bul/olustur
    let user = await this.prisma.user.findUnique({ where: { phone } });
    if (!user) {
      user = await this.prisma.user.create({
        data: {
          name: dto.name?.trim() || 'Sakin',
          phone,
          role: 'GUEST',
          phoneVerified: false,
        },
      });
    }
    // Zaten kayitli mi?
    const existing = await this.prisma.resident.findFirst({
      where: { userId: user.id, apartmentId: apartment.id },
    });
    if (existing) {
      return {
        success: true,
        alreadyExists: true,
        message: 'Bu daireye zaten kayıtlısınız. Uygulamadan telefonunuzla giriş yapabilirsiniz.',
      };
    }
    // Onay bekleyen sakin olarak ekle
    await this.prisma.resident.create({
      data: { userId: user.id, apartmentId: apartment.id, visible: true, approved: false },
    });
    return {
      success: true,
      message: building.buildingName + ' yöneticisine katılım isteğiniz iletildi.',
      building: { id: building.id, buildingName: building.buildingName },
    };
  }


  /**
   * Bir konuma yakin TUM binalari listele (cift bina onleme icin).
   * Sadece bina bilgisi + mesafe doner (sakin yok).
   */
  // Yakindaki GORUNUR binalar (securityMode location/both + ziyaretci binanin KENDI radius'u icinde)
  // Mahremiyet: sakin listesi DONDURMEZ, sadece bina karti.
  async nearbyVisible(lat: number, lng: number) {
    const buildings = await this.prisma.$queryRaw<any[]>`
      SELECT id, building_name, address, type, business_category, block_name, site_name,
        security_mode, image_url, qr_token,
        ST_Distance(
          geography(ST_MakePoint(longitude, latitude)),
          geography(ST_MakePoint(${lng}, ${lat}))
        ) AS distance
      FROM buildings
      WHERE security_mode IN ('location', 'both')
        AND ST_DWithin(
          geography(ST_MakePoint(longitude, latitude)),
          geography(ST_MakePoint(${lng}, ${lat})),
          location_check_radius
        )
      ORDER BY distance ASC
      LIMIT 50
    `;
    // Her bina icin daire/birim sayisi
    const result: any[] = [];
    for (const b of buildings) {
      const flatCount = await this.prisma.apartment.count({ where: { buildingId: b.id } });
      result.push({
        id: b.id,
        buildingName: b.building_name,
        address: b.address,
        type: b.type || 'residential',
        businessCategory: b.business_category,
        blockName: b.block_name,
        siteName: b.site_name,
        securityMode: b.security_mode,
        imageUrl: b.image_url,
        qrToken: b.qr_token,
        flatCount,
        distance: Math.round(Number(b.distance)),
      });
    }
    return result;
  }

  async nearbyBuildings(lat: number, lng: number, radiusMeters = 150) {
    const buildings = await this.prisma.$queryRaw<any[]>`
      SELECT id, building_name, address, type,
        ST_Distance(
          geography(ST_MakePoint(longitude, latitude)),
          geography(ST_MakePoint(${lng}, ${lat}))
        ) AS distance
      FROM buildings
      WHERE ST_DWithin(
        geography(ST_MakePoint(longitude, latitude)),
        geography(ST_MakePoint(${lng}, ${lat})),
        ${radiusMeters}
      )
      ORDER BY distance ASC
      LIMIT 10
    `;
    return buildings.map(b => ({
      id: b.id,
      buildingName: b.building_name,
      address: b.address,
      type: b.type || 'residential',
      distance: Math.round(Number(b.distance)),
    }));
  }

  /**
   * YONETICI yapi kurma: site + bloklar + her blokta N daire uret.
   * Premium kullanici cagirir, owner olur, onay sistemi acilir.
   */
  async createStructure(userId: string, dto: {
    siteName?: string;
    latitude: number;
    longitude: number;
    blocks: { blockName?: string; flatCount: number }[];
  }) {
    // Premium kontrol
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { isPremium: true } });
    if (!user?.isPremium) {
      return { success: false, message: 'Yapı kurmak için premium üyelik gerekli' };
    }
    if (!dto.blocks || dto.blocks.length === 0) {
      return { success: false, message: 'En az bir blok girin' };
    }

    const createdBuildings: any[] = [];
    for (const block of dto.blocks) {
      const count = Math.min(Math.max(block.flatCount || 0, 1), 500); // 1-500 daire siniri
      const token = 'DIAFON-' + randomUUID().replace(/-/g, '');
      // Bina adi: site varsa "Site - Blok", yoksa blok adi veya site adi
      let buildingName = dto.siteName || block.blockName || 'Bina';
      if (dto.siteName && block.blockName) buildingName = `${dto.siteName} ${block.blockName}`;
      else if (block.blockName) buildingName = block.blockName;

      const building = await this.prisma.building.create({
        data: {
          buildingName,
          latitude: dto.latitude,
          longitude: dto.longitude,
          radiusMeter: 100,
          qrToken: token,
          siteName: dto.siteName || null,
          blockName: block.blockName || null,
          ownerUserId: userId,
          requireApproval: true,
        },
      });

      // Daireleri uret (1..count)
      const apartmentData: { buildingId: string; flatNo: string; qrToken: string }[] = [];
      for (let i = 1; i <= count; i++) {
        apartmentData.push({ buildingId: building.id, flatNo: String(i), qrToken: require('crypto').randomBytes(16).toString('hex') });
      }
      await this.prisma.apartment.createMany({ data: apartmentData });

      createdBuildings.push({ id: building.id, buildingName, blockName: block.blockName, flatCount: count, qrToken: token });
    }

    return { success: true, buildings: createdBuildings };
  }

  // Isyeri (ticari birim) olustur - tek bina, tek birim, type=business
  async createBusiness(userId: string, dto: {
    businessName: string;
    category?: string;
    latitude: number;
    longitude: number;
    address?: string;
    unitCount?: number;
  }) {
    if (!dto.businessName?.trim()) {
      return { success: false, message: 'Isletme adi gerekli' };
    }
    if (dto.latitude == null || dto.longitude == null) {
      return { success: false, message: 'Konum gerekli' };
    }
    // Isyeri sahibi otomatik premium (yonetici gibi)
    await this.prisma.user.update({ where: { id: userId }, data: { isPremium: true } });

    const token = 'DIAFON-' + randomUUID().replace(/-/g, '');
    const building = await this.prisma.building.create({
      data: {
        buildingName: dto.businessName.trim(),
        latitude: dto.latitude,
        longitude: dto.longitude,
        address: dto.address || null,
        radiusMeter: 100,
        qrToken: token,
        ownerUserId: userId,
        requireApproval: false,
        type: 'business',
        businessCategory: dto.category || null,
      },
    });
    // Birim sayisi kadar daire/birim olustur
    const count = Math.max(1, dto.unitCount || 1);
    const apartmentData: { buildingId: string; flatNo: string; qrToken: string }[] = [];
    for (let i = 1; i <= count; i++) {
      apartmentData.push({ buildingId: building.id, flatNo: String(i), qrToken: require('crypto').randomBytes(16).toString('hex') });
    }
    await this.prisma.apartment.createMany({ data: apartmentData });
    const apartment = await this.prisma.apartment.findFirst({ where: { buildingId: building.id }, orderBy: { flatNo: 'asc' } });
    // Sahibi ilk birime otomatik onayli sakin (cagriyi o alir)
    if (apartment) {
      await this.prisma.resident.create({
        data: { userId, apartmentId: apartment.id, approved: true, visible: true },
      });
    }
    return { success: true, building: { id: building.id, buildingName: dto.businessName.trim(), qrToken: token, apartmentId: apartment?.id } };
  }
}
