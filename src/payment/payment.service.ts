import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Iyzipay = require('iyzipay');

@Injectable()
export class PaymentService {
  private readonly logger = new Logger('PaymentService');
  private iyzipay: any;

  constructor(private prisma: PrismaService) {
    this.iyzipay = new Iyzipay({
      apiKey: process.env.IYZICO_API_KEY,
      secretKey: process.env.IYZICO_SECRET_KEY,
      uri: process.env.IYZICO_BASE_URL || 'https://sandbox-api.iyzipay.com',
    });
  }

  // Yillik = 10 ay fiyati (2 ay bedava)
  private computeAmount(monthlyPrice: number, period: 'monthly' | 'yearly'): number {
    return period === 'yearly' ? monthlyPrice * 10 : monthlyPrice;
  }

  // Odeme baslat: iyzico checkout form token + URL dondur
  async initialize(userId: string, subscriptionId: string, period: 'monthly' | 'yearly') {
    const sub = await this.prisma.subscription.findUnique({ where: { id: subscriptionId } });
    if (!sub || sub.ownerUserId !== userId) {
      return { success: false, message: 'Abonelik bulunamadi' };
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return { success: false, message: 'Kullanici bulunamadi' };

    const amount = this.computeAmount(sub.monthlyPrice, period);
    const conversationId = `sub_${subscriptionId}_${period}_${Date.now()}`;

    // Odeme kaydi olustur (pending)
    const payment = await this.prisma.payment.create({
      data: {
        userId,
        subscriptionId,
        amount,
        period,
        status: 'pending',
        conversationId,
      },
    });

    const price = amount.toFixed(2);
    const request = {
      locale: 'tr',
      conversationId,
      price,
      paidPrice: price,
      currency: 'TRY',
      basketId: payment.id,
      paymentGroup: 'SUBSCRIPTION',
      callbackUrl: process.env.IYZICO_CALLBACK_URL || 'https://mobildiafon.com/api/payment/callback',
      buyer: {
        id: userId,
        name: user.name || 'Musteri',
        surname: 'Diafon',
        gsmNumber: user.phone || '+905000000000',
        email: user.email || 'musteri@mobildiafon.com',
        identityNumber: '11111111111',
        registrationAddress: 'Turkiye',
        city: 'Istanbul',
        country: 'Turkey',
        ip: '85.34.78.112',
      },
      shippingAddress: {
        contactName: user.name || 'Musteri',
        city: 'Istanbul', country: 'Turkey', address: 'Turkiye',
      },
      billingAddress: {
        contactName: user.name || 'Musteri',
        city: 'Istanbul', country: 'Turkey', address: 'Turkiye',
      },
      basketItems: [{
        id: subscriptionId,
        name: `${sub.scopeName} aboneligi (${period === 'yearly' ? 'Yillik' : 'Aylik'})`,
        category1: 'Abonelik',
        itemType: 'VIRTUAL',
        price,
      }],
    };

    return new Promise((resolve) => {
      this.iyzipay.checkoutFormInitialize.create(request, (err: any, result: any) => {
        if (err || result.status !== 'success') {
          this.logger.error('iyzico initialize hata: ' + JSON.stringify(err || result));
          resolve({ success: false, message: result?.errorMessage || 'Odeme baslatilamadi' });
          return;
        }
        resolve({
          success: true,
          checkoutFormContent: result.checkoutFormContent,
          paymentPageUrl: result.paymentPageUrl,
          token: result.token,
        });
      });
    });
  }

  // Callback: odeme sonucunu dogrula, basariliysa abonelik uzat
  async handleCallback(token: string) {
    return new Promise((resolve) => {
      this.iyzipay.checkoutForm.retrieve({ locale: 'tr', token }, async (err: any, result: any) => {
        if (err || result.status !== 'success' || result.paymentStatus !== 'SUCCESS') {
          this.logger.error('iyzico callback basarisiz: ' + JSON.stringify(err || result));
          // Odeme kaydini failed yap
          if (result?.basketId) {
            await this.prisma.payment.update({ where: { id: result.basketId }, data: { status: 'failed' } }).catch(() => {});
          }
          resolve({ success: false, message: 'Odeme dogrulanamadi' });
          return;
        }
        // Basarili - odeme kaydini guncelle + abonelik uzat
        const paymentId = result.basketId;
        const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
        if (!payment) { resolve({ success: false, message: 'Odeme kaydi yok' }); return; }

        await this.prisma.payment.update({
          where: { id: paymentId },
          data: { status: 'paid', iyzicoPaymentId: result.paymentId, paidAt: new Date() },
        });

        // Abonelik uzat
        const sub = await this.prisma.subscription.findUnique({ where: { id: payment.subscriptionId } });
        if (sub) {
          const now = new Date();
          const base = (sub.currentPeriodEnd && sub.currentPeriodEnd > now) ? sub.currentPeriodEnd : now;
          const months = payment.period === 'yearly' ? 12 : 1;
          const newEnd = new Date(base);
          newEnd.setMonth(newEnd.getMonth() + months);
          await this.prisma.subscription.update({
            where: { id: sub.id },
            data: { status: 'active', currentPeriodEnd: newEnd },
          });
        }
        resolve({ success: true });
      });
    });
  }
}
