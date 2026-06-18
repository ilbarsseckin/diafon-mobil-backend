import { Controller, Get, Post, Body, UseGuards, Req } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CallsService } from './calls.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('calls')
export class CallsController {
  constructor(private callsService: CallsService, private prisma: PrismaService) {}

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
}
