import { Controller, Get, Post, Delete, Body, Param, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { VehiclesService } from './vehicles.service';
import { ActivateVehicleDto } from './dto/vehicle.dto';

@Controller('vehicles')
export class VehiclesController {
  constructor(private service: VehiclesService) {}

  // Kendi araclarim
  @UseGuards(JwtAuthGuard)
  @Get('mine')
  findMine(@Req() req: any) {
    return this.service.findMine(req.user.userId);
  }

  // Camdaki QR ile bilgi (public, sadece arama)
  @Get('lookup/:code')
  lookup(@Param('code') code: string) {
    return this.service.lookupByCode(code);
  }

  // Gizli kod ile aktivasyon (aracı aktive edene baglar + abonelik acar)
  @UseGuards(JwtAuthGuard)
  @Post('activate')
  activate(@Req() req: any, @Body() dto: ActivateVehicleDto) {
    return this.service.activate(req.user.userId, dto.code, dto.secretCode, dto.label, dto.plate);
  }

  // Sahip aracinin aktif mesajini ayarlar/kaldirir
  @UseGuards(JwtAuthGuard)
  @Post(':id/message')
  setMessage(@Req() req: any, @Param('id') id: string, @Body() body: { message?: string }) {
    return this.service.setMessage(req.user.userId, id, body.message ?? null);
  }

  // QR okutan zil calar (public) -> sahibe push
  @Post('ring/:code')
  ring(@Param('code') code: string) {
    return this.service.ringVehicle(code);
  }

  // Araci pasifle / aktifle (sahip)
  @UseGuards(JwtAuthGuard)
  @Post(':id/active')
  setActive(@Req() req: any, @Param('id') id: string, @Body() body: { active: boolean }) {
    return this.service.setVehicleActive(req.user.userId, id, body.active !== false);
  }

  @UseGuards(JwtAuthGuard)
  // --- Ikincil kullanicilar ---
  @UseGuards(JwtAuthGuard)
  @Get(':id/users')
  listUsers(@Req() req: any, @Param('id') id: string) {
    return this.service.listVehicleUsers(req.user.userId, id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/users')
  addUser(@Req() req: any, @Param('id') id: string, @Body() body: { phone: string }) {
    return this.service.addVehicleUser(req.user.userId, id, body.phone);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id/users/:userId')
  removeUser(@Req() req: any, @Param('id') id: string, @Param('userId') userId: string) {
    return this.service.removeVehicleUser(req.user.userId, id, userId);
  }

  @Delete(':id')
  remove(@Req() req: any, @Param('id') id: string) {
    return this.service.remove(req.user.userId, id);
  }
}
