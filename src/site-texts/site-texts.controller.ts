import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { SiteTextsService } from './site-texts.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/guards/roles.decorator';

@Controller('site-texts')
export class SiteTextsController {
  constructor(private service: SiteTextsService) {}

  // Public: frontend tum metinleri ceker
  @Get()
  getAll() {
    return this.service.getAll();
  }

  // Superadmin: toplu guncelle
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Patch()
  updateMany(@Body() body: { items: { key: string; valueTr: string; valueEn: string }[] }) {
    return this.service.updateMany(body.items || []);
  }
}
