import { Injectable, Logger } from '@nestjs/common';
import { DoorAdapter } from './door-adapter.interface';
import * as crypto from 'crypto';

// Tuya Cloud API ile kapi acma (kuru kontak role tetikleme)
// .env: TUYA_ACCESS_ID, TUYA_ACCESS_SECRET, TUYA_BASE_URL (or. https://openapi.tuyaeu.com)
// Role cihazinin DP kodu genelde 'switch_1' (bool true = tetikle)
@Injectable()
export class TuyaAdapter implements DoorAdapter {
  private readonly logger = new Logger('TuyaAdapter');
  private readonly accessId = process.env.TUYA_ACCESS_ID || '';
  private readonly accessSecret = process.env.TUYA_ACCESS_SECRET || '';
  private readonly baseUrl = process.env.TUYA_BASE_URL || 'https://openapi.tuyaeu.com';
  private readonly dpCode = process.env.TUYA_DP_CODE || 'switch_1';

  private token: string | null = null;
  private tokenExpire = 0;

  private sha256(str: string): string {
    return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
  }

  private sign(str: string): string {
    return crypto.createHmac('sha256', this.accessSecret).update(str, 'utf8').digest('hex').toUpperCase();
  }

  // Tuya imzali istek basligi olustur
  private buildHeaders(method: string, path: string, body: string, withToken: boolean): Record<string, string> {
    const t = Date.now().toString();
    const contentHash = this.sha256(body || '');
    const stringToSign = [method, contentHash, '', path].join('\n');
    const accessToken = withToken && this.token ? this.token : '';
    const signStr = this.accessId + accessToken + t + stringToSign;
    const sign = this.sign(signStr);
    const headers: Record<string, string> = {
      'client_id': this.accessId,
      'sign': sign,
      't': t,
      'sign_method': 'HMAC-SHA256',
      'Content-Type': 'application/json',
    };
    if (withToken && this.token) headers['access_token'] = this.token;
    return headers;
  }

  private async ensureToken(): Promise<void> {
    if (this.token && Date.now() < this.tokenExpire) return;
    const path = '/v1.0/token?grant_type=1';
    const headers = this.buildHeaders('GET', path, '', false);
    const res = await fetch(this.baseUrl + path, { method: 'GET', headers });
    const data: any = await res.json();
    if (!data.success) throw new Error('Tuya token alinamadi: ' + (data.msg || 'bilinmeyen'));
    this.token = data.result.access_token;
    this.tokenExpire = Date.now() + (data.result.expire_time - 60) * 1000;
  }

  async open(deviceId: string): Promise<void> {
    if (!this.accessId || !this.accessSecret) {
      throw new Error('Tuya yapilandirilmamis (TUYA_ACCESS_ID/SECRET eksik)');
    }
    await this.ensureToken();
    const path = `/v1.0/devices/${deviceId}/commands`;
    const bodyObj = { commands: [{ code: this.dpCode, value: true }] };
    const body = JSON.stringify(bodyObj);
    const headers = this.buildHeaders('POST', path, body, true);
    const res = await fetch(this.baseUrl + path, { method: 'POST', headers, body });
    const data: any = await res.json();
    if (!data.success) {
      this.logger.error('Tuya komut hatasi: ' + JSON.stringify(data));
      throw new Error('Kapi acilamadi: ' + (data.msg || 'Tuya hatasi'));
    }
    this.logger.log(`Tuya kapi acildi: device=${deviceId}`);
  }
}
