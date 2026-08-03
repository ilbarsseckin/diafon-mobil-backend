import { Controller, Post, Get, Param, Body, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DoorService } from './door.service';
import { CameraService } from './camera.service';

@Controller('door')
export class DoorController {
  constructor(
    private doorService: DoorService,
    private cameraService: CameraService,
  ) {}

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

  // SHELLY SIHIRBAZI: cihaza ozel MQTT kimligi
  @UseGuards(JwtAuthGuard)
  @Post('provision-credentials')
  async provisionCredentials(@Req() req: any, @Body() body: { buildingId: string }) {
    try {
      if (!body?.buildingId) return { success: false, message: 'buildingId gerekli' };
      const creds = await this.doorService.provisionCredentials(req.user.userId, body.buildingId);
      return { success: true, ...creds };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  }

  // Kapinin role cekme suresini degistir
  @UseGuards(JwtAuthGuard)
  @Post('set-pulse')
  async setPulse(@Req() req: any, @Body() body: { doorId: string; seconds: number }) {
    try {
      if (!body?.doorId || !body?.seconds) return { success: false, message: 'doorId ve seconds gerekli' };
      return await this.doorService.setDoorPulse(req.user.userId, body.doorId, body.seconds);
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  }

  // SHELLY SIHIRBAZI: cihaz cevrimici mi
  @UseGuards(JwtAuthGuard)
  @Post('verify')
  async verifyDevice(@Body() body: { deviceId: string }) {
    if (!body?.deviceId?.trim()) return { ok: false, message: 'deviceId gerekli' };
    return this.doorService.verifyDevice(body.deviceId.trim());
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
  // KAMERA: binaya kamera tanimla/guncelle/kapat
  @UseGuards(JwtAuthGuard)
  @Post('set-camera')
  async setCamera(
    @Req() req: any,
    @Body() body: { buildingId: string; rtspUrl?: string; enabled?: boolean },
  ) {
    try {
      const res = await this.cameraService.setCamera(
        req.user.userId,
        body.buildingId,
        body.rtspUrl ?? null,
        body.enabled !== false && !!body.rtspUrl,
      );
      return res;
    } catch (e: any) {
      return { success: false, message: e.message || 'Kamera ayarlanamadi' };
    }
  }

  // KAMERA: binanin kamera stream bilgisini getir (mobil WebRTC icin)
  @UseGuards(JwtAuthGuard)
  @Get('camera/:buildingId')
  async getCamera(@Param('buildingId') buildingId: string) {
    try {
      return await this.cameraService.getCamera(buildingId);
    } catch (e: any) {
      return { hasCamera: false };
    }
  }
}
