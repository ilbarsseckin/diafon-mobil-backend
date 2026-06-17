import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApartmentsService } from './apartments.service';
import { CreateApartmentDto, AssignResidentDto, UpdateVisibilityDto } from './dto/apartment.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/guards/roles.decorator';

@Controller('apartments')
export class ApartmentsController {
  constructor(private service: ApartmentsService) {}

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
}
