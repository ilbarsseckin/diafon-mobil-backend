import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, Req } from '@nestjs/common';
import { ApartmentsService } from './apartments.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateApartmentDto, AssignResidentDto, UpdateVisibilityDto } from './dto/apartment.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/guards/roles.decorator';

@Controller('apartments')
export class ApartmentsController {
  constructor(private service: ApartmentsService, private prisma: PrismaService) {}

  // --- Admin: daire yonetimi ---
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post()
  create(@Body() dto: CreateApartmentDto) {
    return this.service.createApartment(dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get('building/:buildingId')
  listByBuilding(@Param('buildingId') buildingId: string) {
    return this.service.listByBuilding(buildingId);
  }

  // --- Admin: sakin eslestirme ---
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('residents')
  assign(@Body() dto: AssignResidentDto) {
    return this.service.assignResident(dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Delete('residents/:id')
  removeResident(@Param('id') id: string) {
    return this.service.removeResident(id);
  }

  // --- Sakin kendi gorunurlugunu degistirir (rahatsiz etme modu) ---
  @UseGuards(JwtAuthGuard)
  @Patch('residents/:id/visibility')
  setVisibility(@Param('id') id: string, @Body() dto: UpdateVisibilityDto) {
    return this.service.setVisibility(id, dto.visible);
  }

  // --- Kullanici TUM dairelerinde gorunur/gorunmez olur (hayalet mod) ---
  @UseGuards(JwtAuthGuard)
  @Post('me/visibility')
  async setMyVisibility(@Req() req: any, @Body() body: { visible: boolean }) {
    await this.prisma.resident.updateMany({
      where: { userId: req.user.userId },
      data: { visible: body.visible },
    });
    return { success: true, visible: body.visible };
  }

  // --- Kullanicinin mevcut gorunurluk durumu ---
  @UseGuards(JwtAuthGuard)
  @Get('me/visibility')
  async getMyVisibility(@Req() req: any) {
    const residents = await this.prisma.resident.findMany({
      where: { userId: req.user.userId },
      select: { visible: true },
    });
    // Hepsi gorunmezse gorunmez, aksi halde gorunur kabul et
    const allHidden = residents.length > 0 && residents.every((r) => !r.visible);
    return { visible: !allHidden };
  }
}
