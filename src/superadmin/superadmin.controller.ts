import { Controller, Post, Get, Patch, Body, Headers, Res, UnauthorizedException } from '@nestjs/common';
import type { Response } from 'express';
import { SuperadminService } from './superadmin.service';
import { PushService } from '../calls/push.service';
import { SiteTextsService } from '../site-texts/site-texts.service';
import { VehiclesService } from '../vehicles/vehicles.service';
import { VehicleLabelService } from '../vehicles/vehicle-label.service';
import { VehicleOrdersService } from '../vehicle-orders/vehicle-orders.service';

@Controller('superadmin')
export class SuperadminController {
  constructor(private service: SuperadminService, private pushService: PushService, private siteTexts: SiteTextsService, private vehiclesService: VehiclesService, private labelService: VehicleLabelService, private orders: VehicleOrdersService) {}

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

  // Tum isletmeler (token gerekli)
  @Get('businesses')
  async businesses(@Headers('authorization') auth: string) {
    const token = (auth || '').replace('Bearer ', '');
    const expected = 'super_' + Buffer.from(process.env.SUPERADMIN_PASS || 'superadmin2026').toString('base64');
    if (token !== expected) throw new UnauthorizedException('Yetkisiz');
    return this.service.businesses();
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

  @Get('vehicle-orders')
  async vehicleOrders(@Headers('authorization') auth: string) {
    const token = (auth || '').replace('Bearer ', '');
    const expected = 'super_' + Buffer.from(process.env.SUPERADMIN_PASS || 'superadmin2026').toString('base64');
    if (token !== expected) throw new UnauthorizedException('Yetkisiz');
    return this.orders.list();
  }

  @Post('vehicle-orders/ship')
  async shipVehicleOrder(@Headers('authorization') auth: string, @Body() body: { id: string; trackingNo?: string }) {
    const token = (auth || '').replace('Bearer ', '');
    const expected = 'super_' + Buffer.from(process.env.SUPERADMIN_PASS || 'superadmin2026').toString('base64');
    if (token !== expected) throw new UnauthorizedException('Yetkisiz');
    return this.orders.markShipped(body.id, body.trackingNo);
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

  // Site metinlerini getir (superadmin)
  @Get('site-texts')
  async getSiteTexts(@Headers('authorization') auth: string) {
    const token = (auth || '').replace('Bearer ', '');
    const expected = 'super_' + Buffer.from(process.env.SUPERADMIN_PASS || 'superadmin2026').toString('base64');
    if (token !== expected) throw new UnauthorizedException('Yetkisiz');
    return this.siteTexts.getAll();
  }

  // Site metinlerini toplu guncelle (superadmin)
  @Patch('site-texts')
  async updateSiteTexts(@Headers('authorization') auth: string, @Body() body: { items: { key: string; valueTr: string; valueEn: string }[] }) {
    const token = (auth || '').replace('Bearer ', '');
    const expected = 'super_' + Buffer.from(process.env.SUPERADMIN_PASS || 'superadmin2026').toString('base64');
    if (token !== expected) return { success: false, message: 'Yetkisiz' };
    return this.siteTexts.updateMany(body.items || []);
  }
  // Toplu arac karti uret (superadmin) -> code + secretCode listesi + CSV
  @Post('vehicles/generate')
  async generateVehicles(@Headers('authorization') auth: string, @Body() body: { count: number }) {
    const token = (auth || '').replace('Bearer ', '');
    const expected = 'super_' + Buffer.from(process.env.SUPERADMIN_PASS || 'superadmin2026').toString('base64');
    if (token !== expected) throw new UnauthorizedException('Yetkisiz');
    return this.vehiclesService.generateBatch(body.count);
  }
  // Kartin gizli kodunu sifirla (superadmin) -> yeni kod bir kez doner
  @Post('vehicles/reset-secret')
  async resetSecret(@Headers('authorization') auth: string, @Body() body: { code: string }) {
    const token = (auth || '').replace('Bearer ', '');
    const expected = 'super_' + Buffer.from(process.env.SUPERADMIN_PASS || 'superadmin2026').toString('base64');
    if (token !== expected) throw new UnauthorizedException('Yetkisiz');
    return this.vehiclesService.resetSecretCode(body.code);
  }

  // Etiket PDF uret (superadmin). Uretim aninda elde edilen code+secretCode listesinden.
  @Post('vehicles/labels')
  async labels(
    @Headers('authorization') auth: string,
    @Body() body: { cards: { code: string; secretCode: string }[]; format?: string },
    @Res() res: Response,
  ) {
    const token = (auth || '').replace('Bearer ', '');
    const expected = 'super_' + Buffer.from(process.env.SUPERADMIN_PASS || 'superadmin2026').toString('base64');
    if (token !== expected) { res.status(401).json({ message: 'Yetkisiz' }); return; }
    const cards = body.cards || [];
    if (cards.length === 0) { res.status(400).json({ message: 'Kart listesi bos' }); return; }
    const pdf = body.format === 'single'
      ? await this.labelService.generateSingle(cards)
      : await this.labelService.generateA4(cards);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="arac-etiketleri.pdf"');
    res.send(pdf);
  }

  // Tum arac kartlari + ozet (superadmin)
  @Get('vehicles')
  async vehicles(@Headers('authorization') auth: string) {
    const token = (auth || '').replace('Bearer ', '');
    const expected = 'super_' + Buffer.from(process.env.SUPERADMIN_PASS || 'superadmin2026').toString('base64');
    if (token !== expected) throw new UnauthorizedException('Yetkisiz');
    return this.vehiclesService.vehiclesOverview();
  }

  private auth(auth: string) {
    const token = (auth || '').replace('Bearer ', '');
    const expected = 'super_' + Buffer.from(process.env.SUPERADMIN_PASS || 'superadmin2026').toString('base64');
    if (token !== expected) throw new UnauthorizedException('Yetkisiz');
  }

  @Get('invoices')
  async invoices(@Headers('authorization') a: string) {
    this.auth(a);
    return this.service.invoices();
  }

  @Post('invoices/create')
  async createInvoice(@Headers('authorization') a: string, @Body() body: { ownerUserId: string; title?: string; amount?: number; buildingId?: string; vehicleId?: string; note?: string }) {
    this.auth(a);
    return this.service.createInvoice(body);
  }

  @Post('invoices/upload')
  async uploadInvoice(@Headers('authorization') a: string, @Body() body: { id: string; file: string }) {
    this.auth(a);
    return this.service.uploadInvoiceFile(body.id, body.file);
  }

  @Post('invoices/mark-paid')
  async markInvoicePaid(@Headers('authorization') a: string, @Body() body: { id: string; paid: boolean }) {
    this.auth(a);
    return this.service.markInvoicePaid(body.id, body.paid);
  }

  @Post('invoices/send')
  async sendInvoice(@Headers('authorization') a: string, @Body() body: { id: string }) {
    this.auth(a);
    return this.service.sendInvoiceMail(body.id);
  }

}
