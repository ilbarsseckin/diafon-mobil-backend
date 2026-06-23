import { Controller, Post, Get, Param, Body, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DoorService } from './door.service';

@Controller('door')
export class DoorController {
  constructor(private doorService: DoorService) {}

  // Binanin kapilarini listele
  @UseGuards(JwtAuthGuard)
  @Get('list/:buildingId')
  async list(@Req() req: any, @Param('buildingId') buildingId: string) {
    try {
      const doors = await this.doorService.listDoors(req.user.userId, buildingId);
      return { success: true, doors };
    } catch (e: any) {
      return { success: false, message: e.message, doors: [] };
    }
  }

  // Belirli kapiyi ac
  @UseGuards(JwtAuthGuard)
  @Post('open')
  async open(@Req() req: any, @Body() body: { doorId: string; callId?: string }) {
    const ip = (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim();
    try {
      await this.doorService.openDoor(req.user.userId, body.doorId, body.callId || null, ip);
      return { success: true, message: 'Kapi acildi' };
    } catch (e: any) {
      return { success: false, message: e.message || 'Kapi acilamadi' };
    }
  }
}
