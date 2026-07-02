import { Controller, Get, Post, Delete, Body, Param, Query, UseGuards, BadRequestException, Req } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BuildingsService } from './buildings.service';
import { PushService } from '../calls/push.service';
import { SmsService } from '../sms/sms.service';
import { CreateBuildingDto } from './dto/building.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/guards/roles.decorator';

@Controller('buildings')
export class BuildingsController {
  constructor(private service: BuildingsService, private prisma: PrismaService, private push: PushService, private sms: SmsService) {}

  // --- Herkese acik: konuma gore bina + sakin listesi ---
  @Get('nearby')
  nearby(@Query('lat') lat: string, @Query('lng') lng: string) {
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    if (isNaN(latNum) || isNaN(lngNum)) {
      throw new BadRequestException('Geçerli konum (lat, lng) gönderin');
    }
    return this.service.findByLocation(latNum, lngNum);
  }

  // --- Herkese acik: QR token ile bina + sakin listesi ---
  @Get('by-qr')
  byQr(@Query('token') token: string) {
    if (!token) {
      throw new BadRequestException('QR token gerekli');
    }
    return this.service.findByQrToken(token);
  }

  // --- Yakindaki TUM binalar (cift bina onleme) ---
  @Get('nearby-visible')
  async nearbyVisible(@Query('lat') lat: string, @Query('lng') lng: string) {
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    if (isNaN(latNum) || isNaN(lngNum)) return [];
    return this.service.nearbyVisible(latNum, lngNum);
  }

  @Get('nearby-list')
  nearbyList(@Query('lat') lat: string, @Query('lng') lng: string) {
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    if (isNaN(latNum) || isNaN(lngNum)) {
      throw new BadRequestException('Konum gerekli');
    }
    return this.service.nearbyBuildings(latNum, lngNum);
  }
  // --- Herkese acik: web'den telefon ile katilim ---
  @Post('web-join')
  webJoin(@Body() body: { buildingId: string; flatNo: string; name?: string; phone: string }) {
    if (!body.buildingId || !body.flatNo || !body.phone) {
      throw new BadRequestException('Bina, daire ve telefon zorunlu');
    }
    return this.service.webJoin(body);
  }

  // --- Sakin: evini ekle / var olan binaya katil ---
  @UseGuards(JwtAuthGuard)
  @Post('join')
  join(@Req() req: any, @Body() body: {
    buildingName: string; address?: string;
    latitude: number; longitude: number;
    flatNo: string; floor?: string;
  }) {
    if (!body.buildingName || body.latitude == null || body.longitude == null || !body.flatNo) {
      throw new BadRequestException('Bina adi, konum ve daire no zorunlu');
    }
    return this.service.joinOrCreate(req.user.userId, body);
  }

  // --- Sakin: QR ile binaya katil ---
  @UseGuards(JwtAuthGuard)
  @Post('join-by-qr')
  joinByQr(@Req() req: any, @Body() body: { qrToken: string; flatNo: string; floor?: string }) {
    if (!body.qrToken || !body.flatNo) {
      throw new BadRequestException('QR token ve daire no zorunlu');
    }
    return this.service.joinByQr(req.user.userId, body.qrToken, body.flatNo, body.floor);
  }

  // --- Sakin: bir binaya kayitli miyim? ---
  @UseGuards(JwtAuthGuard)
  @Get('my-status')
  async myStatus(@Req() req: any) {
    const resident = await this.prisma.resident.findFirst({
      where: { userId: req.user.userId },
      include: {
        apartment: { include: { building: true } },
      },
    });
    if (!resident) {
      return { registered: false };
    }
    return {
      registered: true,
      building: {
        id: resident.apartment.building.id,
        buildingName: resident.apartment.building.buildingName,
        qrToken: resident.apartment.building.qrToken,
      },
      flatNo: resident.apartment.flatNo,
      userId: req.user.userId,
    };
  }

  // --- Kullanicinin TUM evleri (coklu ev) + her evin diger sakinleri ---
  @UseGuards(JwtAuthGuard)
  @Get('my-homes')
  async myHomes(@Req() req: any) {
    const myResidents = await this.prisma.resident.findMany({
      where: { userId: req.user.userId, approved: true },
      include: { apartment: { include: { building: true } } },
    });
    if (myResidents.length === 0) return { homes: [] };
    const homes: any[] = [];
    for (const mr of myResidents) {
      const apt = mr.apartment;
      // Bu dairedeki DIGER sakinler (kendisi haric, gorunur+onayli)
      const others = await this.prisma.resident.findMany({
        where: { apartmentId: apt.id, approved: true, visible: true, userId: { not: req.user.userId }, user: { blocked: false } },
        include: { user: { select: { id: true, name: true, photoUrl: true, isOnline: true } } },
      });
      // Site/bina kapsami: ayni siteName+owner (site) ise tum bloklar, degilse o bina
      const bld = apt.building;
      const scopeBuildings = bld.siteName
        ? await this.prisma.building.findMany({ where: { siteName: bld.siteName, ownerUserId: bld.ownerUserId } })
        : [bld];
      const scopeIds = scopeBuildings.map((sb) => sb.id);
      const scopeApts = await this.prisma.apartment.findMany({
        where: { buildingId: { in: scopeIds } },
        include: {
          building: { select: { id: true, buildingName: true, blockName: true } },
          residents: {
            where: { approved: true, visible: true, user: { blocked: false } },
            include: { user: { select: { id: true, name: true, photoUrl: true, isOnline: true } } },
          },
        },
      });
      const numCmp2 = (a: string, b: string) => { const na = parseInt(a,10), nb = parseInt(b,10); if(!isNaN(na)&&!isNaN(nb)) return na-nb; return a.localeCompare(b); };
      const siteFlats = scopeApts
        .filter((sa) => sa.residents.length > 0 && sa.id !== apt.id)
        .sort((x, y) => numCmp2(x.flatNo, y.flatNo))
        .map((sa) => ({
          apartmentId: sa.id,
          flatNo: sa.flatNo,
          buildingId: sa.building.id,
          blockName: sa.building.blockName,
          buildingName: sa.building.buildingName,
          residents: sa.residents.map((r) => ({ userId: r.user.id, name: r.user.name, photoUrl: r.user.photoUrl, isOnline: r.user.isOnline })),
        }));
      homes.push({
        apartmentId: apt.id,
        flatNo: apt.flatNo,
        floor: apt.floor,
        buildingId: apt.building.id,
        buildingName: apt.building.buildingName,
        siteName: apt.building.siteName,
        blockName: apt.building.blockName,
        imageUrl: apt.building.imageUrl,
        latitude: apt.building.latitude,
        longitude: apt.building.longitude,
        residents: others.map((o) => ({
          userId: o.user.id,
          name: o.user.name,
          photoUrl: o.user.photoUrl,
          isOnline: o.user.isOnline,
        })),
        siteFlats,
      });
    }
    return { homes };
  }

  // --- YONETICI: tum binalar + daireler + sakinler (yonetim panosu) ---
  @UseGuards(JwtAuthGuard)
  @Get('building-overview')
  async buildingOverview(@Req() req: any) {
    const buildings = await this.prisma.building.findMany({
      where: { ownerUserId: req.user.userId },
      orderBy: [{ siteName: 'asc' }, { blockName: 'asc' }],
    });
    if (buildings.length === 0) return { isManager: false, buildings: [] };
    const buildingIds = buildings.map((b) => b.id);
    const apartments = await this.prisma.apartment.findMany({
      where: { buildingId: { in: buildingIds } },
      include: {
        residents: {
          include: {
            user: { select: { id: true, name: true, phone: true, photoUrl: true } },
          },
        },
      },
    });
    const numCmp = (a: string, b: string) => {
      const na = parseInt(a, 10), nb = parseInt(b, 10);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return a.localeCompare(b);
    };
    return {
      isManager: true,
      buildings: buildings.map((b) => {
        const flats = apartments.filter((a) => a.buildingId === b.id);
        flats.sort((x, y) => numCmp(x.flatNo, y.flatNo));
        return {
          id: b.id,
          qrToken: b.qrToken,
          buildingName: b.buildingName,
          siteName: b.siteName,
          blockName: b.blockName,
          imageUrl: b.imageUrl,
          locationCheckEnabled: b.locationCheckEnabled,
          locationCheckRadius: b.locationCheckRadius,
          securityMode: b.securityMode || 'qr',
          requireApproval: b.requireApproval,
          flatCount: flats.length,
          residentCount: flats.reduce((s, a) => s + a.residents.length, 0),
          flats: flats.map((a) => ({
            apartmentId: a.id,
            flatNo: a.flatNo,
            floor: a.floor,
            listingStatus: a.listingStatus,
            qrToken: a.qrToken,
            qrLabel: a.qrLabel,
            residents: a.residents.map((r) => ({
              residentId: r.id,
              userId: r.user.id,
              name: r.user.name,
              phone: r.user.phone,
              photoUrl: r.user.photoUrl,
              approved: r.approved,
            })),
          })),
        };
      }),
    };
  }

  // --- YONETICI: guvenlik gorevlisi ata ---
  @UseGuards(JwtAuthGuard)
  @Post('add-security')
  async addSecurity(@Req() req: any, @Body() body: { phone: string; guardName?: string }) {
    const owns = await this.prisma.building.findFirst({ where: { ownerUserId: req.user.userId } });
    if (!owns) return { success: false, message: 'Yonetici degilsiniz' };
    const phone = (body.phone || '').trim();
    if (!phone) return { success: false, message: 'Telefon gerekli' };
    try {
      await this.prisma.securityGuard.create({
        data: { ownerUserId: req.user.userId, phone, guardName: body.guardName || null },
      });
    } catch (e) {
      return { success: false, message: 'Bu numara zaten ekli' };
    }
    return { success: true };
  }

  // --- YONETICI: guvenlik listesi ---
  @UseGuards(JwtAuthGuard)
  @Get('list-security')
  async listSecurity(@Req() req: any) {
    const guardRecords = await this.prisma.securityGuard.findMany({
      where: { ownerUserId: req.user.userId },
      orderBy: { createdAt: 'asc' },
    });
    const phones = guardRecords.map((g) => g.phone);
    const users = phones.length
      ? await this.prisma.user.findMany({
          where: { phone: { in: phones } },
          select: { id: true, phone: true },
        })
      : [];
    const guards = guardRecords.map((g) => {
      const u = users.find((x) => x.phone === g.phone);
      return { ...g, userId: u?.id || null };
    });
    return { guards };
  }

  // --- YONETICI: guvenlik cikar ---
  @UseGuards(JwtAuthGuard)
  @Post('remove-security')
  async removeSecurity(@Req() req: any, @Body() body: { id: string }) {
    const g = await this.prisma.securityGuard.findUnique({ where: { id: body.id } });
    if (!g || g.ownerUserId !== req.user.userId) return { success: false, message: 'Yetki yok' };
    await this.prisma.securityGuard.delete({ where: { id: body.id } });
    return { success: true };
  }

  // --- GUVENLIK: kendi sitesinin tum bloklari/daireleri/sakinleri ---
  @UseGuards(JwtAuthGuard)
  @Get('security-overview')
  async securityOverview(@Req() req: any) {
    const assignments = await this.prisma.securityGuard.findMany({ where: { phone: req.user.phone } });
    if (assignments.length === 0) return { isSecurity: false, buildings: [] };
    const ownerIds = [...new Set(assignments.map((a) => a.ownerUserId))];
    const buildings = await this.prisma.building.findMany({
      where: { ownerUserId: { in: ownerIds } },
      orderBy: [{ siteName: 'asc' }, { blockName: 'asc' }],
    });
    const buildingIds = buildings.map((b) => b.id);
    const apartments = await this.prisma.apartment.findMany({
      where: { buildingId: { in: buildingIds } },
      include: {
        residents: {
          where: { approved: true },
          include: { user: { select: { id: true, name: true, phone: true, photoUrl: true } } },
        },
      },
    });
    const numCmp = (a: string, b: string) => {
      const na = parseInt(a, 10), nb = parseInt(b, 10);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return a.localeCompare(b);
    };
    return {
      isSecurity: true,
      buildings: buildings.map((b) => {
        const flats = apartments.filter((a) => a.buildingId === b.id);
        flats.sort((x, y) => numCmp(x.flatNo, y.flatNo));
        return {
          id: b.id, buildingName: b.buildingName, siteName: b.siteName, blockName: b.blockName,
          flatCount: flats.length,
          flats: flats.map((a) => ({
            apartmentId: a.id, flatNo: a.flatNo, listingStatus: a.listingStatus,
            residents: a.residents.map((r) => ({
              name: r.user.name, phone: r.user.phone, photoUrl: r.user.photoUrl,
            })),
          })),
        };
      }),
    };
  }

  // --- NOT: daireye not birak (guvenlik veya yonetici) ---
  @UseGuards(JwtAuthGuard)
  @Post('add-note')
  async addNote(@Req() req: any, @Body() body: { apartmentId: string; text: string; fromRole: string }) {
    const text = (body.text || '').trim();
    if (!text) return { success: false, message: 'Not bos olamaz' };
    const apt = await this.prisma.apartment.findUnique({
      where: { id: body.apartmentId }, include: { building: true },
    });
    if (!apt) return { success: false, message: 'Daire bulunamadi' };
    // Yetki: bina sahibi VEYA bu sitenin guvenligi
    const ownerId = apt.building.ownerUserId;
    const isOwner = ownerId === req.user.userId;
    const isSecurity = ownerId
      ? await this.prisma.securityGuard.findFirst({
          where: { phone: req.user.phone, ownerUserId: ownerId },
        })
      : null;
    const isResident = await this.prisma.resident.findFirst({
      where: { userId: req.user.userId, apartmentId: body.apartmentId, approved: true },
    });
    if (!isOwner && !isSecurity && !isResident) return { success: false, message: 'Yetki yok' };
    const role = isOwner ? 'yonetici' : isSecurity ? 'guvenlik' : 'sakin';
    const me = await this.prisma.user.findUnique({ where: { id: req.user.userId }, select: { name: true } });
    await this.prisma.note.create({
      data: {
        apartmentId: body.apartmentId,
        fromUserId: req.user.userId,
        fromRole: role,
        fromName: me?.name || null,
        text,
      },
    });
    // Daire sakinlerine push bildirim (kendisi haric)
    const roleLabel = role === 'guvenlik' ? 'Guvenlik' : role === 'yonetici' ? 'Yonetici' : 'Sakin';
    const residents = await this.prisma.resident.findMany({
      where: { apartmentId: body.apartmentId, approved: true, userId: { not: req.user.userId } },
      select: { userId: true },
    });
    const receiverIds = residents.map((r) => r.userId);
    if (receiverIds.length > 0) {
      this.push.sendNoteNotification(receiverIds, roleLabel + ' notu', text).catch(() => {});
    }
    return { success: true };
  }

  // --- NOT: dairenin notlarini gor ---
  @UseGuards(JwtAuthGuard)
  @Get('flat-notes')
  async flatNotes(@Req() req: any, @Query('apartmentId') apartmentId: string) {
    const notes = await this.prisma.note.findMany({
      where: { apartmentId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return { notes };
  }

  // --- SAKIN: kendi dairesinin notlari ---
  @UseGuards(JwtAuthGuard)
  @Get('my-notes')
  async myNotes(@Req() req: any) {
    const residencies = await this.prisma.resident.findMany({
      where: { userId: req.user.userId, approved: true },
      include: { apartment: { include: { building: true } } },
    });
    if (residencies.length === 0) return { apartments: [], notes: [], unread: 0 };
    const apartments = residencies.map((r) => ({
      apartmentId: r.apartmentId,
      label: (r.apartment.building.siteName && r.apartment.building.blockName
        ? r.apartment.building.siteName + ' ' + r.apartment.building.blockName
        : r.apartment.building.buildingName) + ' - Daire ' + r.apartment.flatNo,
    }));
    const aptIds = residencies.map((r) => r.apartmentId);
    const notes = await this.prisma.note.findMany({
      where: { apartmentId: { in: aptIds } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const unread = notes.filter((n) => n.fromRole !== 'sakin' && !n.isRead).length;
    return { apartments, notes, unread };
  }

  // --- SAKIN: notlari okundu isaretle ---
  @UseGuards(JwtAuthGuard)
  @Post('mark-notes-read')
  async markNotesRead(@Req() req: any) {
    const residencies = await this.prisma.resident.findMany({
      where: { userId: req.user.userId, approved: true },
    });
    const aptIds = residencies.map((r) => r.apartmentId);
    if (aptIds.length === 0) return { success: true };
    await this.prisma.note.updateMany({
      where: { apartmentId: { in: aptIds }, fromRole: { not: 'sakin' }, isRead: false },
      data: { isRead: true },
    });
    return { success: true };
  }

  // --- YONETICI: bloga daire ekle ---
  @UseGuards(JwtAuthGuard)
  @Post('add-flat')
  async addFlat(@Req() req: any, @Body() body: { buildingId: string; flatNo: string; floor?: string }) {
    const flatNo = (body.flatNo || '').trim();
    if (!flatNo) return { success: false, message: 'Daire no gerekli' };
    const building = await this.prisma.building.findUnique({ where: { id: body.buildingId } });
    if (!building) return { success: false, message: 'Bina bulunamadi' };
    if (building.ownerUserId !== req.user.userId) return { success: false, message: 'Yetki yok' };
    const exists = await this.prisma.apartment.findFirst({ where: { buildingId: body.buildingId, flatNo } });
    if (exists) return { success: false, message: 'Bu daire no zaten var' };
    const flatToken = require('crypto').randomBytes(16).toString('hex');
    await this.prisma.apartment.create({
      data: { buildingId: body.buildingId, flatNo, floor: body.floor || null, qrToken: flatToken },
    });
    return { success: true };
  }

  // --- YONETICI: bos daire sil ---
  @UseGuards(JwtAuthGuard)
  @Post('delete-flat')
  async deleteFlat(@Req() req: any, @Body() body: { apartmentId: string }) {
    const apt = await this.prisma.apartment.findUnique({
      where: { id: body.apartmentId },
      include: { building: true, residents: true },
    });
    if (!apt) return { success: false, message: 'Daire bulunamadi' };
    if (apt.building.ownerUserId !== req.user.userId) return { success: false, message: 'Yetki yok' };
    if (apt.residents.length > 0) return { success: false, message: 'Once sakinleri cikarin' };
    await this.prisma.apartment.delete({ where: { id: body.apartmentId } });
    return { success: true };
  }

  // --- YONETICI: siteye blok ekle ---
  @UseGuards(JwtAuthGuard)
  @Post('add-block')
  async addBlock(@Req() req: any, @Body() body: { fromBuildingId: string; blockName: string; flatCount: number }) {
    const ref = await this.prisma.building.findUnique({ where: { id: body.fromBuildingId } });
    if (!ref) return { success: false, message: 'Bina bulunamadi' };
    if (ref.ownerUserId !== req.user.userId) return { success: false, message: 'Yetki yok' };
    const blockName = (body.blockName || '').trim();
    if (!blockName) return { success: false, message: 'Blok adi gerekli' };
    const count = Math.max(1, Math.min(500, Number(body.flatCount) || 0));
    if (count < 1) return { success: false, message: 'Daire sayisi gecersiz' };
    // Ayni siteName altinda ayni blockName var mi?
    if (ref.siteName) {
      const dup = await this.prisma.building.findFirst({
        where: { siteName: ref.siteName, blockName, ownerUserId: req.user.userId },
      });
      if (dup) return { success: false, message: 'Bu blok zaten var' };
    }
    const qr = 'DIAFON-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    const newBuilding = await this.prisma.building.create({
      data: {
        buildingName: (ref.siteName || ref.buildingName) + ' ' + blockName,
        latitude: ref.latitude, longitude: ref.longitude, radiusMeter: ref.radiusMeter,
        siteName: ref.siteName, blockName, ownerUserId: req.user.userId,
        requireApproval: ref.requireApproval, qrToken: qr,
      },
    });
    const data: { buildingId: string; flatNo: string }[] = [];
    for (let i = 1; i <= count; i++) data.push({ buildingId: newBuilding.id, flatNo: String(i) });
    await this.prisma.apartment.createMany({ data });
    return { success: true, buildingId: newBuilding.id };
  }

  // --- YONETICI: binalarindaki cagri gecmisi (receiver->daire->bina zinciri) ---
  @UseGuards(JwtAuthGuard)
  @Get('call-logs')
  async callLogs(@Req() req: any) {
    const buildings = await this.prisma.building.findMany({
      where: { ownerUserId: req.user.userId },
      select: { id: true, buildingName: true, siteName: true, blockName: true },
    });
    if (buildings.length === 0) return { isManager: false, calls: [] };
    const buildingIds = buildings.map((b) => b.id);
    const bMap = new Map(buildings.map((b) => [b.id, b]));
    // Bu binalardaki dairelerin sakinleri (receiver adaylari)
    const residents = await this.prisma.resident.findMany({
      where: { apartment: { buildingId: { in: buildingIds } } },
      select: { userId: true, apartment: { select: { buildingId: true, flatNo: true } } },
    });
    if (residents.length === 0) return { isManager: true, calls: [] };
    const userToBuilding = new Map<string, { buildingId: string; flatNo: string }>();
    residents.forEach((r) => {
      userToBuilding.set(r.userId, { buildingId: r.apartment.buildingId, flatNo: r.apartment.flatNo });
    });
    const receiverIds = [...userToBuilding.keys()];
    const calls = await this.prisma.call.findMany({
      where: { receiverUserId: { in: receiverIds } },
      orderBy: { startedAt: 'desc' },
      take: 100,
      include: {
        callerUser: { select: { name: true, phone: true } },
        receiverUser: { select: { name: true, phone: true } },
      },
    });
    return {
      isManager: true,
      calls: calls.map((c) => {
        const info = userToBuilding.get(c.receiverUserId);
        const b = info ? bMap.get(info.buildingId) : null;
        const label = b
          ? (b.siteName && b.blockName ? b.siteName + ' ' + b.blockName : b.buildingName)
          : null;
        return {
          id: c.id,
          callerName: c.callerUser?.name || null,
          callerPhone: c.callerUser?.phone || null,
          receiverName: c.receiverUser?.name || null,
          receiverPhone: c.receiverUser?.phone || null,
          buildingLabel: label,
          flatNo: info?.flatNo || null,
          startedAt: c.startedAt,
          duration: c.duration,
          status: c.status,
        };
      }),
    };
  }

  // --- YONETICI: bina resmi yukle ---
  @UseGuards(JwtAuthGuard)
  @Post('set-building-image')
  async setBuildingImage(@Req() req: any, @Body() body: { buildingId: string; photo: string }) {
    const building = await this.prisma.building.findUnique({ where: { id: body.buildingId } });
    if (!building) return { success: false, message: 'Bina bulunamadi' };
    if (building.ownerUserId !== req.user.userId) return { success: false, message: 'Yetki yok' };
    const fs = require('fs');
    const path = require('path');
    const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    const clean = body.photo.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(clean, 'base64');
    const filename = `building_${body.buildingId}_${Date.now()}.jpg`;
    fs.writeFileSync(path.join(uploadsDir, filename), buffer);
    const url = `/uploads/${filename}`;
    await this.prisma.building.update({ where: { id: body.buildingId }, data: { imageUrl: url } });
    return { success: true, url };
  }

  @UseGuards(JwtAuthGuard)
  @Post('update-name')
  async updateBuildingName(@Req() req: any, @Body() body: { buildingId: string; buildingName?: string; siteName?: string }) {
    const building = await this.prisma.building.findUnique({ where: { id: body.buildingId } });
    if (!building) return { success: false, message: 'Bina bulunamadi' };
    if (building.ownerUserId !== req.user.userId) return { success: false, message: 'Yetki yok' };
    const name = (body.buildingName || '').trim();
    if (!name) return { success: false, message: 'Bina adi bos olamaz' };
    const data: any = { buildingName: name };
    if (body.siteName !== undefined) data.siteName = (body.siteName || '').trim() || null;
    await this.prisma.building.update({ where: { id: body.buildingId }, data });
    return { success: true, buildingName: name };
  }

  // --- YONETICI: konum dogrulama ac/kapa + mesafe ---
  @UseGuards(JwtAuthGuard)
  @Post('set-location-check')
  async setLocationCheck(@Req() req: any, @Body() body: { buildingId: string; enabled: boolean; radius?: number }) {
    const building = await this.prisma.building.findUnique({ where: { id: body.buildingId } });
    if (!building) return { success: false, message: 'Bina bulunamadi' };
    if (building.ownerUserId !== req.user.userId) return { success: false, message: 'Yetki yok' };
    let r = building.locationCheckRadius;
    if (typeof body.radius === 'number' && body.radius >= 20 && body.radius <= 2000) r = Math.round(body.radius);
    await this.prisma.building.update({
      where: { id: body.buildingId },
      data: { locationCheckEnabled: !!body.enabled, locationCheckRadius: r },
    });
    return { success: true, enabled: !!body.enabled, radius: r };
  }

  @UseGuards(JwtAuthGuard)
  @Post('set-security-mode')
  async setSecurityMode(@Req() req: any, @Body() body: { buildingId: string; mode: string; radius?: number }) {
    const building = await this.prisma.building.findUnique({ where: { id: body.buildingId } });
    if (!building) return { success: false, message: 'Bina bulunamadi' };
    if (building.ownerUserId !== req.user.userId) return { success: false, message: 'Yetki yok' };
    const validModes = ['qr', 'location', 'both'];
    if (!validModes.includes(body.mode)) return { success: false, message: 'Gecersiz mod' };
    let r = building.locationCheckRadius;
    if (typeof body.radius === 'number' && body.radius >= 20 && body.radius <= 2000) r = Math.round(body.radius);
    // securityMode + geriye uyumluluk: locationCheckEnabled'i de senkronla (FAZ 3D eski kod icin)
    const locEnabled = body.mode === 'location' || body.mode === 'both';
    await this.prisma.building.update({
      where: { id: body.buildingId },
      data: { securityMode: body.mode, locationCheckEnabled: locEnabled, locationCheckRadius: r },
    });
    return { success: true, mode: body.mode, radius: r };
  }

  // --- YONETICI: bina kapilari listele (yonetim) ---
  @UseGuards(JwtAuthGuard)
  @Get('manage-doors/:buildingId')
  async manageDoors(@Req() req: any, @Param('buildingId') buildingId: string) {
    const building = await this.prisma.building.findUnique({ where: { id: buildingId } });
    if (!building) return { success: false, message: 'Bina bulunamadi', doors: [] };
    if (building.ownerUserId !== req.user.userId) return { success: false, message: 'Yetki yok', doors: [] };
    const doors = await this.prisma.door.findMany({ where: { buildingId }, orderBy: { sortOrder: 'asc' } });
    return { success: true, doors };
  }

  // --- YONETICI: kapi ekle ---
  @UseGuards(JwtAuthGuard)
  @Post('add-door')
  async addDoor(@Req() req: any, @Body() body: { buildingId: string; name: string; deviceId: string; adapter?: string }) {
    const building = await this.prisma.building.findUnique({ where: { id: body.buildingId } });
    if (!building) return { success: false, message: 'Bina bulunamadi' };
    if (building.ownerUserId !== req.user.userId) return { success: false, message: 'Yetki yok' };
    if (!body.name?.trim() || !body.deviceId?.trim()) return { success: false, message: 'Isim ve cihaz ID gerekli' };
    const count = await this.prisma.door.count({ where: { buildingId: body.buildingId } });
    const door = await this.prisma.door.create({
      data: {
        buildingId: body.buildingId,
        name: body.name.trim(),
        deviceId: body.deviceId.trim(),
        adapter: body.adapter || 'tuya',
        sortOrder: count,
      },
    });
    return { success: true, door };
  }

  // --- YONETICI: kapi sil ---
  @UseGuards(JwtAuthGuard)
  @Post('delete-door')
  async deleteDoor(@Req() req: any, @Body() body: { doorId: string }) {
    const door = await this.prisma.door.findUnique({ where: { id: body.doorId } });
    if (!door) return { success: false, message: 'Kapi bulunamadi' };
    const building = await this.prisma.building.findUnique({ where: { id: door.buildingId } });
    if (!building || building.ownerUserId !== req.user.userId) return { success: false, message: 'Yetki yok' };
    await this.prisma.door.delete({ where: { id: body.doorId } });
    return { success: true };
  }

  // --- YONETICI: daire satilik/kiralik durumu degistir ---
  @UseGuards(JwtAuthGuard)
  @Post('set-listing')
  async setListing(@Req() req: any, @Body() body: { apartmentId: string; status: string }) {
    const allowed = ['none', 'sale', 'rent'];
    if (!allowed.includes(body.status)) {
      return { success: false, message: 'Gecersiz durum' };
    }
    // Daireyi bul + bina sahibi mi kontrol et
    const apartment = await this.prisma.apartment.findUnique({
      where: { id: body.apartmentId },
      include: { building: true },
    });
    if (!apartment) return { success: false, message: 'Daire bulunamadi' };
    if (apartment.building.ownerUserId !== req.user.userId) {
      return { success: false, message: 'Bu daire icin yetkiniz yok' };
    }
    await this.prisma.apartment.update({
      where: { id: body.apartmentId },
      data: { listingStatus: body.status },
    });
    return { success: true, status: body.status };
  }

  // --- YONETICI: daire QR etiketini guncelle ---
  @UseGuards(JwtAuthGuard)
  @Post('set-flat-qr-label')
  async setFlatQrLabel(@Req() req: any, @Body() body: { apartmentId: string; label: string }) {
    const apartment = await this.prisma.apartment.findUnique({
      where: { id: body.apartmentId },
      include: { building: true },
    });
    if (!apartment) return { success: false, message: 'Daire bulunamadi' };
    if (apartment.building.ownerUserId !== req.user.userId) {
      return { success: false, message: 'Bu daire icin yetkiniz yok' };
    }
    const label = (body.label || '').trim().slice(0, 80);
    await this.prisma.apartment.update({
      where: { id: body.apartmentId },
      data: { qrLabel: label || null },
    });
    return { success: true, label };
  }

  // --- Herkese acik: daire QR token ile daire + sakin bilgisi ---
  @Get('by-flat-qr')
  async byFlatQr(@Query('token') token: string) {
    if (!token) throw new BadRequestException('QR token gerekli');
    const apartment = await this.prisma.apartment.findUnique({
      where: { qrToken: token },
      include: {
        building: { select: { id: true, buildingName: true, qrToken: true, imageUrl: true } },
        residents: {
          where: { approved: true, visible: true, user: { blocked: false } },
          include: { user: { select: { id: true, name: true, photoUrl: true, isOnline: true } } },
        },
      },
    });
    if (!apartment) return { found: false, message: 'Gecersiz QR kod' };
    return {
      found: true,
      flat: {
        apartmentId: apartment.id,
        flatNo: apartment.flatNo,
        floor: apartment.floor,
        qrLabel: apartment.qrLabel,
      },
      building: apartment.building,
      residents: apartment.residents.map(r => ({
        userId: r.user.id,
        name: r.user.name,
        photoUrl: r.user.photoUrl,
        isOnline: r.user.isOnline,
      })),
    };
  }

  // --- YONETICI: bekleyen sakinleri listele ---
  @UseGuards(JwtAuthGuard)
  @Get('pending-residents')
  async pendingResidents(@Req() req: any) {
    // Bu kullanicinin yonetici oldugu binalar
    const buildings = await this.prisma.building.findMany({
      where: { ownerUserId: req.user.userId },
      select: { id: true, buildingName: true, blockName: true },
    });
    if (buildings.length === 0) return { isManager: false, pending: [] };
    const buildingIds = buildings.map(b => b.id);
    const pending = await this.prisma.resident.findMany({
      where: { approved: false, apartment: { buildingId: { in: buildingIds } } },
      include: {
        user: { select: { id: true, name: true, phone: true, photoUrl: true } },
        apartment: { select: { flatNo: true, floor: true, buildingId: true } },
      },
    });
    return {
      isManager: true,
      buildings,
      pending: pending.map(p => ({
        residentId: p.id,
        userId: p.user.id,
        name: p.user.name,
        phone: p.user.phone,
        photoUrl: p.user.photoUrl,
        flatNo: p.apartment.flatNo,
        floor: p.apartment.floor,
        buildingId: p.apartment.buildingId,
      })),
    };
  }

  // --- YONETICI: sakini onayla ---
  @UseGuards(JwtAuthGuard)
  @Post('approve-resident')
  async approveResident(@Req() req: any, @Body() body: { residentId: string }) {
    const resident = await this.prisma.resident.findUnique({
      where: { id: body.residentId },
      include: { apartment: { select: { buildingId: true } } },
    });
    if (!resident) return { success: false, message: 'Sakin bulunamadi' };
    // Yetki: bu bina bu kullanicinin mi?
    const building = await this.prisma.building.findUnique({ where: { id: resident.apartment.buildingId } });
    if (!building || building.ownerUserId !== req.user.userId) {
      return { success: false, message: 'Yetkiniz yok' };
    }
    await this.prisma.resident.update({ where: { id: body.residentId }, data: { approved: true } });
    // Sakine onay SMS'i gonder
    try {
      const fullResident = await this.prisma.resident.findUnique({
        where: { id: body.residentId },
        include: { user: { select: { phone: true } }, apartment: { select: { flatNo: true } } },
      });
      if (fullResident?.user?.phone) {
        const msg = `Diafon: ${building.buildingName} - Daire ${fullResident.apartment.flatNo} icin katiliminiz onaylandi. Uygulamayi indirip telefonunuzla giris yapin: https://mobildiafon.com`;
        await this.sms.send(fullResident.user.phone, msg);
      }
    } catch (e) {}
    return { success: true };
  }

  // --- YONETICI: sakini reddet/sil ---
  @UseGuards(JwtAuthGuard)
  @Post('reject-resident')
  async rejectResident(@Req() req: any, @Body() body: { residentId: string }) {
    const resident = await this.prisma.resident.findUnique({
      where: { id: body.residentId },
      include: { apartment: { select: { buildingId: true } } },
    });
    if (!resident) return { success: false, message: 'Sakin bulunamadi' };
    const building = await this.prisma.building.findUnique({ where: { id: resident.apartment.buildingId } });
    if (!building || building.ownerUserId !== req.user.userId) {
      return { success: false, message: 'Yetkiniz yok' };
    }
    await this.prisma.resident.delete({ where: { id: body.residentId } });
    return { success: true };
  }

  // --- Bir binanin dairelerini listele (sakin secimi icin) ---
  @Get('building-flats')
  async buildingFlats(@Query('buildingId') buildingId: string) {
    const building = await this.prisma.building.findUnique({
      where: { id: buildingId },
      select: { id: true, buildingName: true, requireApproval: true },
    });
    if (!building) return { found: false };
    const apartments = await this.prisma.apartment.findMany({
      where: { buildingId },
      include: { residents: { where: { approved: true }, select: { id: true } } },
      orderBy: { flatNo: 'asc' },
    });
    return {
      found: true,
      building,
      flats: apartments.map(a => ({
        apartmentId: a.id,
        flatNo: a.flatNo,
        floor: a.floor,
        residentCount: a.residents.length,
      })),
    };
  }

  // --- YONETICI: yapi kur (site + bloklar + daireler) ---
  @UseGuards(JwtAuthGuard)
  @Post('create-structure')
  async createStructure(@Req() req: any, @Body() body: {
    siteName?: string;
    latitude: number;
    longitude: number;
    blocks: { blockName?: string; flatCount: number }[];
  }) {
    return this.service.createStructure(req.user.userId, body);
  }

  @UseGuards(JwtAuthGuard)
  @Post('create-business')
  async createBusiness(@Req() req: any, @Body() body: {
    businessName: string;
    category?: string;
    latitude: number;
    longitude: number;
    address?: string;
    unitCount?: number;
  }) {
    return this.service.createBusiness(req.user.userId, body);
  }

  // --- Admin: bina yonetimi ---
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post()
  create(@Body() dto: CreateBuildingDto) {
    return this.service.create(dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get()
  findAll() {
    return this.service.findAll();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
