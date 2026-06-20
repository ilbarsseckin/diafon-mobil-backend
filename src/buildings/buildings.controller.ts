import { Controller, Get, Post, Delete, Body, Param, Query, UseGuards, BadRequestException, Req } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BuildingsService } from './buildings.service';
import { CreateBuildingDto } from './dto/building.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/guards/roles.decorator';

@Controller('buildings')
export class BuildingsController {
  constructor(private service: BuildingsService, private prisma: PrismaService) {}

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
  @Get('nearby-list')
  nearbyList(@Query('lat') lat: string, @Query('lng') lng: string) {
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    if (isNaN(latNum) || isNaN(lngNum)) {
      throw new BadRequestException('Konum gerekli');
    }
    return this.service.nearbyBuildings(latNum, lngNum);
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
