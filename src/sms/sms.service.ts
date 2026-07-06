import { Injectable, Logger } from '@nestjs/common';
import * as https from 'https';

@Injectable()
export class SmsService {
  private readonly logger = new Logger('SmsService');
  private readonly username = process.env.NETGSM_USERNAME || '';
  private readonly password = process.env.NETGSM_PASSWORD || '';
  private readonly header = process.env.NETGSM_HEADER || 'DIAFON';

  async send(phone: string, message: string): Promise<boolean> {
    const gsm = phone.replace(/^\+/, '').replace(/^0/, '90');
    const path = `/sms/send/get/?usercode=${this.username}&password=${this.password}&gsmno=${gsm}&message=${encodeURIComponent(message)}&msgheader=${this.header}`;

    return new Promise((resolve) => {
      const options = {
        hostname: 'api.netgsm.com.tr',
        port: 443,
        path,
        method: 'GET',
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          this.logger.log(`NetGSM yanit [${gsm}]: ${data.trim()}`);
          resolve(data.trim().startsWith('0'));
        });
      });

      req.on('error', (e) => {
        this.logger.error('NetGSM hata: ' + e.message);
        resolve(false);
      });

      req.end();
    });
  }

  async sendSubscriptionWarning(phone: string, buildingName: string, daysLeft: number): Promise<void> {
    const msg = `${buildingName} binanizin Diafon aboneligi ${daysLeft} gun icinde sona erecek. Yenilemek icin uygulamayi acin.`;
    await this.send(phone, msg);
  }

  async sendSubscriptionExpired(phone: string, buildingName: string): Promise<void> {
    const msg = `${buildingName} binanizin Diafon aboneligi sona erdi. Hizmet kesintisiz devam etsin icin uygulamayi acin.`;
    await this.send(phone, msg);
  }

  async sendOtp(phone: string, code: string): Promise<void> {
    const msg = `Diafon dogrulama kodunuz: ${code}`;
    await this.send(phone, msg);
  }
}
