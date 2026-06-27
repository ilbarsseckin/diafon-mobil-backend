import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger('MailService');
  private transporter: nodemailer.Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.MAIL_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.MAIL_PORT || '587'),
      secure: false,
      requireTLS: true,
      auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASS,
      },
    });
  }

  async send(to: string, subject: string, html: string): Promise<boolean> {
    try {
      await this.transporter.sendMail({
        from: process.env.MAIL_FROM || 'Diafon <info@smartdiafon.com>',
        to,
        subject,
        html,
      });
      this.logger.log(`Mail gonderildi: ${to}`);
      return true;
    } catch (e) {
      this.logger.error(`Mail gonderilemedi: ${to} - ${e.message}`);
      return false;
    }
  }

  // Hoş geldin maili
  async sendWelcome(to: string, name: string): Promise<void> {
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <div style="background:#E63946;padding:24px;text-align:center;">
          <h1 style="color:white;margin:0;">Diafon'a Hoş Geldiniz!</h1>
        </div>
        <div style="padding:24px;background:#f9f9f9;">
          <p>Merhaba <strong>${name}</strong>,</p>
          <p>Diafon ailesine katıldığınız için teşekkür ederiz. Artık binanızın interkom sistemini akıllı telefonunuzdan yönetebilirsiniz.</p>
          <p>Herhangi bir sorunuz için bize ulaşabilirsiniz.</p>
          <br>
          <p>İyi kullanımlar,<br><strong>Diafon Ekibi</strong></p>
        </div>
        <div style="padding:16px;text-align:center;color:#999;font-size:12px;">
          <p>© 2026 Diafon. Tüm hakları saklıdır.</p>
        </div>
      </div>
    `;
    await this.send(to, 'Diafon\'a Hoş Geldiniz!', html);
  }

  // Abonelik başladı
  async sendSubscriptionActivated(to: string, name: string, buildingName: string, endDate: Date): Promise<void> {
    const tarih = endDate.toLocaleDateString('tr-TR');
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <div style="background:#E63946;padding:24px;text-align:center;">
          <h1 style="color:white;margin:0;">Aboneliğiniz Aktif!</h1>
        </div>
        <div style="padding:24px;background:#f9f9f9;">
          <p>Merhaba <strong>${name}</strong>,</p>
          <p><strong>${buildingName}</strong> için Diafon aboneliğiniz başarıyla aktif edildi.</p>
          <p>Abonelik bitiş tarihi: <strong>${tarih}</strong></p>
          <br>
          <p>İyi kullanımlar,<br><strong>Diafon Ekibi</strong></p>
        </div>
        <div style="padding:16px;text-align:center;color:#999;font-size:12px;">
          <p>© 2026 Diafon. Tüm hakları saklıdır.</p>
        </div>
      </div>
    `;
    await this.send(to, 'Aboneliğiniz Aktif Edildi', html);
  }

  // Abonelik bitiş uyarısı
  async sendSubscriptionWarning(to: string, name: string, buildingName: string, daysLeft: number): Promise<void> {
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <div style="background:#FF9800;padding:24px;text-align:center;">
          <h1 style="color:white;margin:0;">Abonelik Bitiyor!</h1>
        </div>
        <div style="padding:24px;background:#f9f9f9;">
          <p>Merhaba <strong>${name}</strong>,</p>
          <p><strong>${buildingName}</strong> için Diafon aboneliğinizin bitmesine <strong>${daysLeft} gün</strong> kaldı.</p>
          <p>Hizmet kesintisi yaşamamak için uygulamadan aboneliğinizi yenileyebilirsiniz.</p>
          <br>
          <p>İyi kullanımlar,<br><strong>Diafon Ekibi</strong></p>
        </div>
        <div style="padding:16px;text-align:center;color:#999;font-size:12px;">
          <p>© 2026 Diafon. Tüm hakları saklıdır.</p>
        </div>
      </div>
    `;
    await this.send(to, `Aboneliğiniz ${daysLeft} Gün İçinde Sona Eriyor`, html);
  }

  // Abonelik süresi doldu
  async sendSubscriptionExpired(to: string, name: string, buildingName: string): Promise<void> {
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <div style="background:#f44336;padding:24px;text-align:center;">
          <h1 style="color:white;margin:0;">Aboneliğiniz Sona Erdi</h1>
        </div>
        <div style="padding:24px;background:#f9f9f9;">
          <p>Merhaba <strong>${name}</strong>,</p>
          <p><strong>${buildingName}</strong> için Diafon aboneliğiniz sona erdi.</p>
          <p>Hizmetinizin devam etmesi için lütfen uygulamadan aboneliğinizi yenileyin.</p>
          <br>
          <p>İyi kullanımlar,<br><strong>Diafon Ekibi</strong></p>
        </div>
        <div style="padding:16px;text-align:center;color:#999;font-size:12px;">
          <p>© 2026 Diafon. Tüm hakları saklıdır.</p>
        </div>
      </div>
    `;
    await this.send(to, 'Aboneliğiniz Sona Erdi', html);
  }
}
