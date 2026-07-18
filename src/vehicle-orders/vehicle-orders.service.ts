import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { VehiclesService } from '../vehicles/vehicles.service';
import { MailService } from '../mail/mail.service';
import { SmsService } from '../sms/sms.service';
const Iyzipay = require('iyzipay');

@Injectable()
export class VehicleOrdersService {
  private logger = new Logger('VehicleOrders');
  private iyzipay: any;

  constructor(private prisma: PrismaService, private vehicles: VehiclesService, private mail: MailService, private sms: SmsService) {
    this.iyzipay = new Iyzipay({
      apiKey: process.env.IYZICO_API_KEY,
      secretKey: process.env.IYZICO_SECRET_KEY,
      uri: process.env.IYZICO_BASE_URL || 'https://api.iyzipay.com',
    });
  }

  private price(): number {
    return parseInt(process.env.VEHICLE_PRODUCT_PRICE || '790', 10);
  }

  async initialize(data: {
    buyerName: string; buyerPhone: string; buyerEmail?: string;
    shipCity: string; shipDistrict?: string; shipAddress: string; buyerUserId?: string;
  }) {
    if (!data.buyerName?.trim() || !data.buyerPhone?.trim() || !data.shipAddress?.trim() || !data.shipCity?.trim()) {
      throw new BadRequestException('Ad, telefon, il ve adres zorunlu');
    }
    const amount = this.price();
    const conversationId = `vorder_${Date.now()}`;
    const order = await this.prisma.vehicleOrder.create({
      data: {
        buyerName: data.buyerName.trim(),
        buyerPhone: data.buyerPhone.trim(),
        buyerEmail: data.buyerEmail?.trim() || null,
        shipCity: data.shipCity.trim(),
        shipDistrict: data.shipDistrict?.trim() || null,
        shipAddress: data.shipAddress.trim(),
        amount,
        status: 'pending',
        conversationId,
        buyerUserId: data.buyerUserId || null,
      },
    });

    const price = amount.toFixed(2);
    const nameParts = data.buyerName.trim().split(' ');
    const surname = nameParts.length > 1 ? nameParts.pop()! : 'Diafon';
    const name = nameParts.join(' ') || data.buyerName.trim();
    const fullAddr = `${data.shipAddress.trim()}${data.shipDistrict ? ', ' + data.shipDistrict : ''}`;

    const request = {
      locale: 'tr',
      conversationId,
      price,
      paidPrice: price,
      currency: 'TRY',
      basketId: order.id,
      paymentGroup: 'PRODUCT',
      callbackUrl: process.env.VEHICLE_ORDER_CALLBACK_URL || 'https://mobildiafon.com/api/vehicle-orders/callback',
      buyer: {
        id: order.id, name, surname,
        gsmNumber: data.buyerPhone.trim(),
        email: data.buyerEmail?.trim() || 'musteri@mobildiafon.com',
        identityNumber: '11111111111',
        registrationAddress: fullAddr,
        city: data.shipCity.trim(), country: 'Turkey', ip: '85.34.78.112',
      },
      shippingAddress: { contactName: data.buyerName.trim(), city: data.shipCity.trim(), country: 'Turkey', address: fullAddr },
      billingAddress: { contactName: data.buyerName.trim(), city: data.shipCity.trim(), country: 'Turkey', address: fullAddr },
      basketItems: [{
        id: 'arac-qr',
        name: 'MobilDiafon Auto QR Etiketi (1 Yillik Abonelik Dahil)',
        category1: 'Arac QR', itemType: 'PHYSICAL', price,
      }],
    };

    return new Promise((resolve) => {
      this.iyzipay.checkoutFormInitialize.create(request, (err: any, result: any) => {
        if (err || result.status !== 'success') {
          this.logger.error('iyzico arac-order initialize hata: ' + JSON.stringify(err || result));
          resolve({ success: false, message: 'Odeme baslatilamadi' });
          return;
        }
        resolve({ success: true, orderId: order.id, token: result.token, checkoutFormContent: result.checkoutFormContent, paymentPageUrl: result.paymentPageUrl });
      });
    });
  }

  async handleCallback(token: string) {
    return new Promise((resolve) => {
      this.iyzipay.checkoutForm.retrieve({ locale: 'tr', token }, async (err: any, result: any) => {
        if (err || result.status !== 'success' || result.paymentStatus !== 'SUCCESS') {
          this.logger.error('arac-order callback basarisiz: ' + JSON.stringify(err || result));
          if (result?.basketId) {
            await this.prisma.vehicleOrder.update({ where: { id: result.basketId }, data: { status: 'failed' } }).catch(() => {});
          }
          resolve({ success: false, message: 'Odeme dogrulanamadi' });
          return;
        }
        const orderId = result.basketId;
        const order = await this.prisma.vehicleOrder.findUnique({ where: { id: orderId } });
        if (!order) { resolve({ success: false, message: 'Siparis bulunamadi' }); return; }
        if (order.status === 'paid') { resolve({ success: true, already: true }); return; }

        let vcode: string | null = null, vsecret: string | null = null;
        try {
          const batch = await this.vehicles.generateBatch(1);
          vcode = batch.cards[0].code;
          vsecret = batch.cards[0].secretCode;
        } catch (e) {
          this.logger.error('arac kodu uretilemedi: ' + e);
        }

        await this.prisma.vehicleOrder.update({
          where: { id: orderId },
          data: { status: 'paid', iyzicoPaymentId: result.paymentId, paidAt: new Date(), vehicleCode: vcode, vehicleSecretCode: vsecret },
        });
        this.logger.log(`Arac siparisi odendi: ${orderId} kod=${vcode}`);
        // Musteriye siparis onayi (e-posta + SMS)
        if (order.buyerEmail && order.buyerEmail.includes('@')) {
          const bhtml = `<h2>Siparisiniz alindi!</h2>
<p>Merhaba ${order.buyerName},</p>
<p>MobilDiafon Auto QR etiketi siparisiniz ve odemeniz basariyla alindi. Kartiniz en kisa surede belirttiginiz adrese kargolanacaktir.</p>
<p><b>Siparis tutari:</b> ${order.amount} TL<br/>
<b>Teslimat adresi:</b> ${order.shipCity}${order.shipDistrict ? ' / ' + order.shipDistrict : ''}</p>
<p>Kartiniz elinize ulastiginda uzerindeki gizli kod ile aracinizi aktive edip hemen kullanmaya baslayabilirsiniz.</p>
<p>Bizi tercih ettiginiz icin tesekkur ederiz.<br/>MobilDiafon</p>`;
          this.mail.send(order.buyerEmail, 'Siparisiniz Alindi - MobilDiafon Auto', bhtml).catch((e) => this.logger.error('musteri mail hata: ' + e));
        }
        if (order.buyerPhone && order.buyerPhone.trim()) {
          this.sms.send(order.buyerPhone, `MobilDiafon: Siparisiniz ve odemeniz alindi. Arac QR kartiniz en kisa surede adresinize kargolanacak. Tesekkurler.`).catch((e) => this.logger.error('musteri sms hata: ' + e));
        }

        resolve({ success: true });
      });
    });
  }

  async list() {
    const orders = await this.prisma.vehicleOrder.findMany({ orderBy: { createdAt: 'desc' } });
    return orders.map((o: any) => ({ ...o, refund: this.refundInfo(o) }));
  }

  async markShipped(id: string, trackingNo?: string) {
    const exists = await this.prisma.vehicleOrder.findUnique({ where: { id } });
    if (!exists) throw new BadRequestException('Siparis bulunamadi');
    const order = await this.prisma.vehicleOrder.update({
      where: { id },
      data: { shipStatus: 'shipped', trackingNo: trackingNo?.trim() || null, shippedAt: new Date() },
    });

    // Musteriye kargo bildirimi + aktive etme adimlari
    const trackLine = order.trackingNo ? ` Takip no: ${order.trackingNo}.` : '';
    if (order.buyerEmail && order.buyerEmail.includes('@')) {
      const html = `<h2>Kartiniz kargolandi!</h2>
<p>Merhaba ${order.buyerName},</p>
<p>MobilDiafon Auto QR kartiniz kargoya verildi.${order.trackingNo ? ' Takip numaraniz: <b>' + order.trackingNo + '</b>' : ''}</p>
<h3>Karti nasil aktive edersiniz?</h3>
<ol>
<li>MobilDiafon uygulamasini telefonunuza indirin ve telefon numaranizla giris yapin.</li>
<li>Uygulamada <b>Araclarim</b> bolumune girip <b>Arac Ekle / Aktive Et</b> secenegini secin.</li>
<li>Kartin uzerindeki <b>gizli kodu</b> girin. Araciniz hesabiniza taninir ve 1 yillik aboneliginiz baslar.</li>
<li>Karti aracinizin on camina yapistirin. Artik biri QR'i okuttugunda, numaraniz gizli kalarak size ulasabilir.</li>
</ol>
<p>Iyi gunlerde kullanin!<br/>MobilDiafon</p>`;
      this.mail.send(order.buyerEmail, 'Kartiniz Kargolandi - MobilDiafon Auto', html).catch((e) => this.logger.error('kargo mail hata: ' + e));
    }
    if (order.buyerPhone && order.buyerPhone.trim()) {
      this.sms.send(order.buyerPhone, `MobilDiafon: Arac QR kartiniz kargolandi.${trackLine} Kart gelince uygulamadan gizli kod ile aktive edip kullanmaya baslayabilirsiniz.`).catch((e) => this.logger.error('kargo sms hata: ' + e));
    }

    return order;
  }

  private readonly TAG_AMOUNT = 190;
  private readonly REFUND_DAYS = 14;

  refundInfo(order: any) {
    if (order.status === 'pending') {
      return { canCancel: true, canRefund: false, amount: 0, reason: 'Odeme yapilmadi, iptal edilebilir' };
    }
    if (order.status !== 'paid') {
      return { canCancel: false, canRefund: false, amount: 0, reason: 'Bu siparis icin islem yapilamaz' };
    }
    const baseDate = order.shippedAt || order.paidAt;
    if (!baseDate) {
      return { canCancel: false, canRefund: true, amount: order.amount, reason: 'Kargolanmadi, tam iade' };
    }
    const days = Math.floor((Date.now() - new Date(baseDate).getTime()) / 86400000);
    if (days > this.REFUND_DAYS) {
      return { canCancel: false, canRefund: false, amount: 0, reason: 'Iade suresi doldu (' + days + ' gun oldu)' };
    }
    const shipped = order.shipStatus === 'shipped';
    return {
      canCancel: false,
      canRefund: true,
      amount: shipped ? order.amount - this.TAG_AMOUNT : order.amount,
      reason: shipped ? ('Kargolandi, ' + this.TAG_AMOUNT + ' TL etiket bedeli kesilir') : 'Kargolanmadi, tam iade',
    };
  }

  async cancelOrder(id: string, reason?: string) {
    const order = await this.prisma.vehicleOrder.findUnique({ where: { id } });
    if (!order) throw new BadRequestException('Siparis bulunamadi');
    if (order.status !== 'pending') throw new BadRequestException('Sadece odenmemis siparis iptal edilebilir');
    return this.prisma.vehicleOrder.update({
      where: { id },
      data: { status: 'cancelled', cancelledAt: new Date(), refundReason: reason ? reason.trim() : null },
    });
  }

  async refundOrder(id: string, reason?: string) {
    const order: any = await this.prisma.vehicleOrder.findUnique({ where: { id } });
    if (!order) throw new BadRequestException('Siparis bulunamadi');
    if (order.refundedAt) throw new BadRequestException('Zaten iade edildi');
    const info = this.refundInfo(order);
    if (!info.canRefund) throw new BadRequestException(info.reason);

    if (order.vehicleCode) {
      const vehicle = await this.prisma.vehicle.findUnique({ where: { code: order.vehicleCode } });
      if (vehicle) {
        await this.prisma.vehicle.update({ where: { id: vehicle.id }, data: { status: 'burned' } });
        await this.prisma.subscription.updateMany({
          where: { vehicleId: vehicle.id },
          data: { status: 'cancelled', cancelledAt: new Date() },
        });
      }
    }

    const updated = await this.prisma.vehicleOrder.update({
      where: { id },
      data: {
        status: 'refunded',
        refundedAt: new Date(),
        refundAmount: info.amount,
        refundReason: reason ? reason.trim() : null,
        vehicleSecretCode: null,
      },
    });

    if (order.buyerEmail && order.buyerEmail.includes('@')) {
      const kesinti = order.shipStatus === 'shipped'
        ? '<p>Kart size ulastigi icin ' + this.TAG_AMOUNT + ' TL etiket bedeli dusulmustur.</p><p><b>Onemli:</b> Kartinizi lutfen imha edin. Kart uzerindeki kod iptal edilmistir, tekrar kullanilamaz. Bize geri gondermenize gerek yoktur.</p>'
        : '';
      const html = '<h2>Iade talebiniz islendi</h2>'
        + '<p>Merhaba ' + order.buyerName + ',</p>'
        + '<p>MobilDiafon Auto siparisiniz iade edildi. Iade tutari: <b>' + info.amount + ' TL</b>.</p>'
        + kesinti
        + '<p>Iade tutari 3-7 is gunu icinde odeme yaptiginiz karta yansiyacaktir.</p>'
        + '<p>MobilDiafon</p>';
      this.mail.send(order.buyerEmail, 'Iadeniz Islendi - MobilDiafon Auto', html).catch((e) => this.logger.error('iade mail hata: ' + e));
    }
    if (order.buyerPhone && order.buyerPhone.trim()) {
      this.sms.send(order.buyerPhone, 'MobilDiafon: Iadeniz islendi. Tutar ' + info.amount + ' TL, 3-7 is gunu icinde kartiniza yansir. Kartinizi imha ediniz.').catch((e) => this.logger.error('iade sms hata: ' + e));
    }

    this.logger.log('IADE: siparis=' + id + ' tutar=' + info.amount);
    return { ...updated, refundedAmount: info.amount };
  }

}
