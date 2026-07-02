import { Controller, Post, Get, Body, Headers, UnauthorizedException } from '@nestjs/common';
import { SuperadminService } from './superadmin.service';
import { PushService } from '../calls/push.service';

@Controller('superadmin')
export class SuperadminController {
  constructor(private service: SuperadminService, private pushService: PushService) {}

  private checkPass(pass: string): boolean {
    const real = process.env.SUPERADMIN_PASS || 'superadmin2026';
    return pass === real;
  }

  // Basit sifre girisi -> token (sifrenin kendisi token olarak doner, basit)
  @Post('login')
  async login(@Body() body: { password: string }) {
    if (!this.checkPass(body.password)) {
      return { success: false, message: 'Sifre hatali' };
    }
    return { success: true, token: 'super_' + Buffer.from(body.password).toString('base64') };
  }

  // Tum musteriler (token gerekli)
  @Get('customers')
  async customers(@Headers('authorization') auth: string) {
    const token = (auth || '').replace('Bearer ', '');
    const expected = 'super_' + Buffer.from(process.env.SUPERADMIN_PASS || 'superadmin2026').toString('base64');
    if (token !== expected) throw new UnauthorizedException('Yetkisiz');
    return this.service.customers();
  }

  @Post('set-free')
  async setFree(@Headers('authorization') auth: string, @Body() body: { ownerId: string; free: boolean }) {
    const token = (auth || '').replace('Bearer ', '');
    const expected = 'super_' + Buffer.from(process.env.SUPERADMIN_PASS || 'superadmin2026').toString('base64');
    if (token !== expected) return { success: false, message: 'Yetkisiz' };
    return this.service.setFree(body.ownerId, body.free);
  }

  @Get('overview')
  async overview(@Headers('authorization') auth: string) {
    const token = (auth || '').replace('Bearer ', '');
    const expected = 'super_' + Buffer.from(process.env.SUPERADMIN_PASS || 'superadmin2026').toString('base64');
    if (token !== expected) throw new UnauthorizedException('Yetkisiz');
    return this.service.overview();
  }

  // Toplu duyuru/reklam push gonder (tum kullanicilara)
  @Post('broadcast')
  async broadcast(@Headers('authorization') auth: string, @Body() body: { title: string; body: string; userIds?: string[] }) {
    const token = (auth || '').replace('Bearer ', '');
    const expected = 'super_' + Buffer.from(process.env.SUPERADMIN_PASS || 'superadmin2026').toString('base64');
    if (token !== expected) return { success: false, message: 'Yetkisiz' };
    if (!body.title || !body.body) return { success: false, message: 'Baslik ve mesaj zorunlu' };
    const result = await this.pushService.sendBroadcast(body.title, body.body, body.userIds);
    return { success: true, sent: result.sent };
  }
}
