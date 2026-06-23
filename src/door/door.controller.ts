import { Controller, Post, Body, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DoorService } from './door.service';

@Controller('door')
export class DoorController {
  constructor(private doorService: DoorService) {}

  // Kapiyi ac (yetkili sakin/yonetici, aktif cagri sirasinda)
  @UseGuards(JwtAuthGuard)
  @Post('open')
  async open(@Req() req: any, @Body() body: { buildingId: string; callId?: string }) {
    const ip = (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim();
    try {
      await this.doorService.openDoor(req.user.userId, body.buildingId, body.callId || null, ip);
      return { success: true, message: 'Kapi acildi' };
    } catch (e: any) {
      return { success: false, message: e.message || 'Kapi acilamadi' };
    }
  }
}
