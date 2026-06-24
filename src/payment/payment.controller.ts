import { Controller, Post, Get, Body, Req, Res, UseGuards, Query } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PaymentService } from './payment.service';

@Controller('payment')
export class PaymentController {
  constructor(private readonly service: PaymentService) {}

  // Odeme baslat (kullanici giris yapmis olmali)
  @UseGuards(JwtAuthGuard)
  @Post('initialize')
  async initialize(@Req() req: any, @Body() body: { subscriptionId: string; period: 'monthly' | 'yearly' }) {
    const period = body.period === 'yearly' ? 'yearly' : 'monthly';
    return this.service.initialize(req.user.userId, body.subscriptionId, period);
  }

  // iyzico callback - odeme sonrasi buraya POST eder (token ile)
  @Post('callback')
  async callback(@Body() body: any, @Res() res: Response) {
    const token = body?.token;
    if (!token) {
      return res.redirect('https://mobildiafon.com/odeme-sonuc?durum=hata');
    }
    const result: any = await this.service.handleCallback(token);
    if (result.success) {
      return res.redirect('https://mobildiafon.com/odeme-sonuc?durum=basarili');
    }
    return res.redirect('https://mobildiafon.com/odeme-sonuc?durum=hata');
  }
}
