import { Controller, Get, Post, Body, UseGuards, Req } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CallsService } from './calls.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PushService } from './push.service';

@Controller('calls')
export class CallsController {
  constructor(private callsService: CallsService, private prisma: PrismaService, private push: PushService) {}

  // Cagri gecmisim
  @UseGuards(JwtAuthGuard)
  @Get('history')
  history(@Req() req: any) {
    return this.callsService.history(req.user.userId);
  }

  // Misafir fotosu yukle (cagri kaydina bagla)
  @UseGuards(JwtAuthGuard)
  @Post('photo')
  async uploadPhoto(@Body() body: { callId?: string; photo: string }) {
    const url = await this.callsService.savePhoto(body.photo);
    if (body.callId) {
      await this.prisma.call.update({
        where: { id: body.callId },
        data: { callerPhotoUrl: url },
      }).catch(() => {});
    }
    return { url };
  }
  // ZIL CAL - ziyaretci daireye zil calar, sakinlerin telefonu oter (gorusme baslatmadan)
  @Post('ring')
  async ring(@Body() body: { apartmentId: string; visitorName?: string; sound?: string }) {
    if (!body.apartmentId) return { success: false, message: 'Daire gerekli' };
    const apt = await this.prisma.apartment.findUnique({
      where: { id: body.apartmentId },
      include: { building: true },
    });
    if (!apt) return { success: false, message: 'Daire bulunamadi' };
    const residents = await this.prisma.resident.findMany({
      where: { apartmentId: body.apartmentId, visible: true, approved: true, user: { blocked: false } },
      include: { user: true },
    });
    if (residents.length === 0) return { success: false, message: 'Bu dairede zil calinabilecek sakin yok' };
    const receiverIds = residents.map((r) => r.user.id);
    const visitorName = (body.visitorName && body.visitorName.trim()) ? body.visitorName.trim() : 'Ziyaretci';
    const buildingName = apt.building?.buildingName || 'Bina';
    await this.push.sendDoorbell(receiverIds, visitorName, buildingName, body.sound);
    return { success: true, message: 'Zil calindi', count: receiverIds.length };
  }
}
