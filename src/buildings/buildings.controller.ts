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
      },
      flatNo: resident.apartment.flatNo,
    };
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
