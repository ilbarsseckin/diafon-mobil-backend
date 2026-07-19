import { Injectable } from '@nestjs/common';
import * as QRCode from 'qrcode';
const PDFDocument = require('pdfkit');

const BASE_URL = 'https://mobildiafon.com/web/arac.html?code=';
const FONT_REG = '/usr/share/fonts/dejavu/DejaVuSans.ttf';
const FONT_BOLD = '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf';
const FONT_MONO = '/usr/share/fonts/dejavu/DejaVuSansMono-Bold.ttf';
const RED = '#E63946';
const NAVY = '#1B2A4A';

@Injectable()
export class VehicleLabelService {
  // Bir kartin QR data URL'sini uret (sadece code linki, gizli kod QR'da YOK)
  // Tek kartin QR PNG'i (public - superadmin panelinden indirilir)
  async singleQr(code: string): Promise<Buffer> {
    return this.qrBuffer(code);
  }

  private async qrBuffer(code: string): Promise<Buffer> {
    return QRCode.toBuffer(BASE_URL + code, {
      type: 'png',
      errorCorrectionLevel: 'H',
      margin: 1,
      width: 300,
      color: { dark: '#000000', light: '#FFFFFF' },
    });
  }

  // Tek bir etiketi belirtilen konuma ciz
  private async drawLabel(
    doc: any,
    code: string,
    secretCode: string,
    x: number,
    y: number,
    w: number,
    h: number,
  ) {
    // Cerceve
    doc.roundedRect(x, y, w, h, 6).lineWidth(0.5).stroke('#cccccc');

    const cx = x + w / 2;
    let cursorY = y + 8;

    // Marka
    doc.fillColor(RED).font(FONT_BOLD).fontSize(9)
      .text('MobilDiafon', x, cursorY, { width: w, align: 'center' });
    cursorY += 11;
    doc.fillColor(NAVY).font(FONT_BOLD).fontSize(7)
      .text('AUTO', x, cursorY, { width: w, align: 'center' });
    cursorY += 12;

    // QR
    const qrSize = Math.min(w * 0.5, h * 0.42);
    const qr = await this.qrBuffer(code);
    doc.image(qr, cx - qrSize / 2, cursorY, { width: qrSize, height: qrSize });
    cursorY += qrSize + 6;

    // Aciklama
    doc.fillColor('#333333').font(FONT_REG).fontSize(6.5)
      .text('Araç sahibine ulaşmak için okutun', x + 4, cursorY, { width: w - 8, align: 'center' });
    cursorY += 14;
    doc.fillColor('#888888').font(FONT_REG).fontSize(6)
      .text('mobildiafon.com', x, cursorY, { width: w, align: 'center' });
    cursorY += 12;

    // Kesme cizgisi
    doc.save();
    doc.dash(2, { space: 2 }).moveTo(x + 6, cursorY).lineTo(x + w - 6, cursorY).lineWidth(0.5).stroke('#999999');
    doc.undash();
    doc.restore();
    // Makas isareti
    doc.fillColor('#999999').fontSize(6).text('✂', x + 4, cursorY - 4);
    cursorY += 8;

    // Gizli kod (kesilecek kisim)
    doc.fillColor('#666666').font(FONT_REG).fontSize(6)
      .text('Aktivasyon Kodu', x, cursorY, { width: w, align: 'center' });
    cursorY += 8;
    doc.fillColor(NAVY).font(FONT_MONO).fontSize(12)
      .text(secretCode, x, cursorY, { width: w, align: 'center' });
  }

  // A4'e 3x4 = 12 etiket/sayfa
  async generateA4(cards: { code: string; secretCode: string }[]): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A4', margin: 20 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const cols = 3, rows = 4, perPage = cols * rows;
    const pageW = 595.28, pageH = 841.89, margin = 20;
    const cellW = (pageW - margin * 2) / cols;
    const cellH = (pageH - margin * 2) / rows;

    for (let i = 0; i < cards.length; i++) {
      if (i > 0 && i % perPage === 0) doc.addPage();
      const idx = i % perPage;
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const x = margin + col * cellW + 4;
      const y = margin + row * cellH + 4;
      await this.drawLabel(doc, cards[i].code, cards[i].secretCode, x, y, cellW - 8, cellH - 8);
    }
    doc.end();
    return new Promise((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
    });
  }

  // Her etiket ayri sayfa (tekil, ~54x85mm ~ 153x241pt)
  async generateSingle(cards: { code: string; secretCode: string }[]): Promise<Buffer> {
    const labelW = 153, labelH = 241;
    const doc = new PDFDocument({ size: [labelW, labelH], margin: 0 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));

    for (let i = 0; i < cards.length; i++) {
      if (i > 0) doc.addPage({ size: [labelW, labelH], margin: 0 });
      await this.drawLabel(doc, cards[i].code, cards[i].secretCode, 4, 4, labelW - 8, labelH - 8);
    }
    doc.end();
    return new Promise((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
    });
  }

  // ---- URETIM ETIKETI (matbaa) ----
  /** Tek sticker: beyaz zemin, siyah yazi, kirmizi vurgu */
  private async drawSticker(doc: any, code: string, x: number, y: number, w: number, h: number, sira?: string) {
    const R = 8;
    doc.save();
    doc.roundedRect(x, y, w, h, R).fill('#FFFFFF');
    doc.roundedRect(x, y, w, h, R).lineWidth(0.7).stroke('#D5DAE0');
    doc.restore();

    const cx = x + w / 2;
    const pad = w * 0.08;

    const lineSize = w * 0.052;
    const okutSize = w * 0.10;
    const siteY = y + h - pad * 0.75 - lineSize * 0.9;
    const altY = siteY - lineSize * 0.5;
    const madde2Y = altY - lineSize * 1.5;
    const madde1Y = madde2Y - lineSize * 1.7;
    const okutY = madde1Y - okutSize * 1.5;

    // Marka
    let cy = y + pad * 0.75;
    const brandSize = w * 0.108;
    doc.font(FONT_BOLD).fontSize(brandSize);
    const wMobil = doc.widthOfString('Mobil');
    const wDiafon = doc.widthOfString('Diafon');
    const bx = cx - (wMobil + wDiafon) / 2;
    doc.fillColor('#111827').text('Mobil', bx, cy, { lineBreak: false });
    doc.fillColor(RED).text('Diafon', bx + wMobil, cy, { lineBreak: false });
    cy += brandSize * 1.12;

    // AUTO rozeti
    const badgeW = w * 0.20, badgeH = w * 0.055;
    doc.roundedRect(cx - badgeW / 2, cy, badgeW, badgeH, badgeH / 2).fill(RED);
    doc.fillColor('#FFFFFF').font(FONT_BOLD).fontSize(badgeH * 0.58)
      .text('AUTO', cx - badgeW / 2, cy + badgeH * 0.24, { width: badgeW, align: 'center' });
    cy += badgeH + w * 0.035;

    doc.moveTo(x + pad, cy).lineTo(x + w - pad, cy).lineWidth(0.5).stroke('#E2E6EB');
    cy += w * 0.045;

    // QR
    const bosluk = okutY - cy - w * 0.03;
    const qrSize = Math.min(w * 0.66, bosluk);
    const qrY = cy + (bosluk - qrSize) / 2;
    const qr = await this.qrBuffer(code);
    doc.image(qr, cx - qrSize / 2, qrY, { width: qrSize, height: qrSize });

    // QR'I OKUT
    doc.fillColor('#111827').font(FONT_BOLD).fontSize(okutSize)
      .text("QR'I OKUT", x, okutY, { width: w, align: 'center' });

    // Maddeler
    const dotR = lineSize * 0.38;
    const maddeler: [string, string, number][] = [
      [RED, 'Araç sahibine güvenle ulaş', madde1Y],
      ['#2FA84F', 'Uygulama gerekmez', madde2Y],
    ];
    for (const [renk, metin, my] of maddeler) {
      doc.font(FONT_REG).fontSize(lineSize);
      const tw = doc.widthOfString(metin);
      const blokW = dotR * 2 + 3.5 + tw;
      const mx = cx - blokW / 2;
      doc.circle(mx + dotR, my + lineSize * 0.40, dotR).fill(renk);
      doc.fillColor('#374151').font(FONT_REG).fontSize(lineSize)
        .text(metin, mx + dotR * 2 + 3.5, my, { lineBreak: false });
    }

    // Site adresi
    doc.fillColor('#6B7280').font(FONT_BOLD).fontSize(lineSize * 0.95)
      .text('mobildiafon.com', x, siteY, { width: w, align: 'center' });

    // Sira numarasi (kesim/eslestirme icin, cok soluk)
    if (sira) {
      doc.fillColor('#C8CDD3').font(FONT_REG).fontSize(w * 0.032)
        .text(sira, x + pad * 0.5, y + h - w * 0.055, { lineBreak: false });
    }
  }

  /** Gizli kod fisi */
  private drawSecretSlip(doc: any, code: string, secretCode: string, x: number, y: number, w: number, h: number, sira?: string) {
    doc.roundedRect(x, y, w, h, 4).lineWidth(0.5).dash(2, { space: 2 }).stroke('#B0B8C1');
    doc.undash();
    let cy = y + h * 0.13;
    doc.fillColor('#5A6470').font(FONT_REG).fontSize(7)
      .text('AKTİVASYON KODU', x, cy, { width: w, align: 'center' });
    cy += 11;
    doc.fillColor('#111827').font(FONT_MONO).fontSize(16)
      .text(secretCode || '-', x, cy, { width: w, align: 'center' });
    cy += 21;
    doc.fillColor('#9AA3AD').font(FONT_REG).fontSize(6)
      .text(code + '  ·  mobildiafon.com', x, cy, { width: w, align: 'center' });
    if (sira) {
      doc.fillColor('#C8CDD3').font(FONT_REG).fontSize(6)
        .text(sira, x + 5, y + h - 10, { lineBreak: false });
    }
  }

  /** Kesim isareti */
  private cropMark(doc: any, x: number, y: number, len = 6) {
    doc.moveTo(x - len, y).lineTo(x + len, y).lineWidth(0.3).stroke('#C0C0C0');
    doc.moveTo(x, y - len).lineTo(x, y + len).lineWidth(0.3).stroke('#C0C0C0');
  }

  /**
   * Matbaa PDF'i: her kart icin 2 ayni sticker + 1 gizli kod fisi.
   * A4'e 4 kart/sayfa (2x2 blok).
   */
  async generateProduction(cards: { code: string; secretCode: string }[]): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A4', margin: 0 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));

    const pageW = 595.28, pageH = 841.89;
    const MM = 2.8346;               // 1mm = 2.8346pt
    const stW = 45 * MM, stH = 58 * MM;   // sticker 45x58mm
    const gap = 4 * MM;              // stickerlar arasi
    const slipH = 16 * MM;
    const blokW = stW * 2 + gap;
    const blokH = stH + 4 * MM + slipH;

    const cols = 2, rows = 3, perPage = cols * rows;
    const colGap = 6 * MM, rowGap = 6 * MM;
    const totalW = blokW * cols + colGap;
    const totalH = blokH * rows + rowGap * 2;
    const offX = (pageW - totalW) / 2;
    const offY = (pageH - totalH) / 2;

    for (let i = 0; i < cards.length; i++) {
      if (i > 0 && i % perPage === 0) doc.addPage({ size: 'A4', margin: 0 });
      const idx = i % perPage;
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const bx = offX + col * (blokW + colGap);
      const by = offY + row * (blokH + rowGap);

      // Iki ayni sticker
      const sira = String(i + 1).padStart(4, '0');
      await this.drawSticker(doc, cards[i].code, bx, by, stW, stH, sira);
      await this.drawSticker(doc, cards[i].code, bx + stW + gap, by, stW, stH, sira);

      // Kesim isaretleri
      this.cropMark(doc, bx, by);
      this.cropMark(doc, bx + stW, by);
      this.cropMark(doc, bx + stW + gap, by);
      this.cropMark(doc, bx + blokW, by);
      this.cropMark(doc, bx, by + stH);
      this.cropMark(doc, bx + blokW, by + stH);

      // Gizli kod fisi
      this.drawSecretSlip(doc, cards[i].code, cards[i].secretCode,
        bx, by + stH + 4 * MM, blokW, slipH, sira);
    }

    doc.end();
    return new Promise((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
    });
  }

}
