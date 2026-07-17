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
}
