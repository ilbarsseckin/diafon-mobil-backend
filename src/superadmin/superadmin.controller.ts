import { Controller, Post, Get, Body, Headers, UnauthorizedException } from '@nestjs/common';
import { SuperadminService } from './superadmin.service';

@Controller('superadmin')
export class SuperadminController {
  constructor(private service: SuperadminService) {}

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

  @Get('overview')
  async overview(@Headers('authorization') auth: string) {
    const token = (auth || '').replace('Bearer ', '');
    const expected = 'super_' + Buffer.from(process.env.SUPERADMIN_PASS || 'superadmin2026').toString('base64');
    if (token !== expected) throw new UnauthorizedException('Yetkisiz');
    return this.service.overview();
  }
}
