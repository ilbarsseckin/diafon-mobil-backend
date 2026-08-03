import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Netgsm Custom API: gelen cagrida tuslanan kodu alir,
// call_codes tablosunda bulur, "dynamic redirect" ile sakine yonlendirir.
// Donen JSON formati Netgsm dokumanina birebir uyar.
@Injectable()
export class CallService {
  private readonly logger = new Logger('CallService');
  private readonly token = process.env.NETGSM_TOKEN || '';
  // Basit suistimal korumasi: ayni kod 15 sn'de en fazla 1 kez
  private lastCall = new Map<string, number>();

  async route(body: any) {
    // 1) Token kontrolu (Netgsm fonksiyonunda sabit degisken olarak tanimlanacak)
    if (!this.token || body?.token !== this.token) {
      this.logger.warn('Netgsm webhook: gecersiz token');
      return { status: 'error', result: 'e', data: 'Yetkisiz istek' };
    }

    // 2) Tuslanan kod (tuslama yoksa Netgsm -1 gonderir)
    const code = String(body?.tus_bilgisi ?? '').trim();
    const arayan = String(body?.arayan_no ?? '?');
    if (!code || code === '-1') {
      return { status: 'success', result: '2', data: 'Kod alinamadi, lutfen tekrar deneyin' };
    }

    // 3) Rate limit: ayni kod cok sik aranamasin
    const now = Date.now();
    const last = this.lastCall.get(code) || 0;
    if (now - last < 15000) {
      this.logger.warn(`Rate limit: kod=${code} arayan=${arayan}`);
      return { status: 'success', result: '2', data: 'Lutfen biraz sonra tekrar deneyin' };
    }

    // 4) Kodu bul
    const cc = await (this.prismaAny()).callCode.findFirst({
      where: { code, enabled: true },
    });
    if (!cc) {
      this.logger.warn(`Kod bulunamadi: ${code} arayan=${arayan}`);
      return { status: 'success', result: '2', data: 'Girdiginiz kod bulunamadi' };
    }

    // 5) Yonlendir
    this.lastCall.set(code, now);
    this.logger.log(`Yonlendirme: kod=${code} -> ${cc.label} (arayan=${arayan}, arama_id=${body?.arama_id ?? '-'})`);
    return {
      status: 'success',
      result: 'dynamic',
      data: `${cc.label} araniyor`,
      redirect: cc.phone,
    };
  }

  constructor(private prisma: PrismaService) {}
  // Prisma client tipi migration sonrasi generate ile gelir; buildde sorun
  // cikmasin diye any uzerinden erisiyoruz.
  private prismaAny(): any {
    return this.prisma as any;
  }
}
