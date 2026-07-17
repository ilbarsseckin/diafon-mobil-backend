import { Controller, Post, Body, Res } from '@nestjs/common';
import type { Response } from 'express';
import { VehicleOrdersService } from './vehicle-orders.service';

@Controller('vehicle-orders')
export class VehicleOrdersController {
  constructor(private service: VehicleOrdersService) {}

  @Post('initialize')
  initialize(@Body() body: any) {
    return this.service.initialize(body);
  }

  @Post('callback')
  async callback(@Body() body: any, @Res() res: Response) {
    const token = body?.token;
    if (!token) return res.redirect('https://mobildiafon.com/arac-siparis?durum=hata');
    const result: any = await this.service.handleCallback(token);
    if (result?.success) return res.redirect('https://mobildiafon.com/arac-siparis?durum=basarili');
    return res.redirect('https://mobildiafon.com/arac-siparis?durum=hata');
  }
}
