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

  // BASE_URL eklemeden, verilen metni oldugu gibi kodlar.
  private async qrRaw(url: string, dark = '#1B2A4A'): Promise<Buffer> {
    return QRCode.toBuffer(url, {
      type: 'png',
      errorCorrectionLevel: 'H',
      margin: 1,
      width: 600,
      color: { dark, light: '#FFFFFF' },
    });
  }

  private async qrBuffer(code: string, dark = '#1B2A4A'): Promise<Buffer> {
    return QRCode.toBuffer(BASE_URL + code, {
      type: 'png',
      errorCorrectionLevel: 'H',
      margin: 1,
      width: 600,
      color: { dark, light: '#FFFFFF' },
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
  /** Tek sticker: beyaz zemin, lacivert cerceve, lacivert QR */
  private async drawSticker(doc: any, code: string, x: number, y: number, w: number, h: number, sira?: string) {
    const NAVY = '#1B2A4A';
    const R = w * 0.075;

    // Zemin + kalin lacivert cerceve
    doc.save();
    doc.roundedRect(x, y, w, h, R).fill('#FFFFFF');
    doc.roundedRect(x + w * 0.022, y + w * 0.022, w - w * 0.044, h - w * 0.044, R * 0.82)
      .lineWidth(w * 0.017).stroke(NAVY);
    doc.restore();

    const cx = x + w / 2;
    const pad = w * 0.085;

    // ---- Alt bloktan yukari hesap ----
    const siteSize = w * 0.050;
    const siteY = y + h - pad * 0.62 - siteSize;
    const kirmiziY = siteY - w * 0.030;
    const tikSize = w * 0.046;
    const tikY = kirmiziY - w * 0.028 - tikSize;
    const altBaslikSize = w * 0.055;
    const altBaslikY = tikY - altBaslikSize * 1.30;
    const okutSize = w * 0.098;
    const okutY = altBaslikY - okutSize * 1.20;

    // ---- Ust: marka ----
    let cy = y + pad * 0.78;
    const brandSize = w * 0.115;
    doc.font(FONT_BOLD).fontSize(brandSize);
    const wMobil = doc.widthOfString('Mobil');
    const wDiafon = doc.widthOfString('Diafon');
    const bx = cx - (wMobil + wDiafon) / 2;
    doc.fillColor(NAVY).text('Mobil', bx, cy, { lineBreak: false });
    doc.fillColor(RED).text('Diafon', bx + wMobil, cy, { lineBreak: false });
    cy += brandSize * 1.05;

    // ---- Ayirici: cizgi + orta ikon + AUTO rozeti ----
    const ikonR = w * 0.030;
    const ayirY = cy + ikonR;
    const solBas = x + pad * 0.72;
    const badgeW = w * 0.170, badgeH = w * 0.050;
    const sagSon = x + w - pad * 0.72;
    const badgeX = sagSon - badgeW;

    // sol lacivert cizgi
    doc.moveTo(solBas, ayirY).lineTo(cx - ikonR * 1.7, ayirY).lineWidth(w * 0.009).stroke(NAVY);
    // sag kirmizi cizgi (rozete kadar)
    doc.moveTo(cx + ikonR * 1.7, ayirY).lineTo(badgeX - w * 0.022, ayirY).lineWidth(w * 0.009).stroke(RED);
    // orta ikon: ic ice halkalar
    doc.circle(cx, ayirY, ikonR).lineWidth(w * 0.010).stroke(NAVY);
    doc.circle(cx, ayirY, ikonR * 0.42).fill(NAVY);
    // AUTO rozeti
    doc.roundedRect(badgeX, ayirY - badgeH / 2, badgeW, badgeH, badgeH / 2).fill(RED);
    doc.fillColor('#FFFFFF').font(FONT_BOLD).fontSize(badgeH * 0.56)
      .text('AUTO', badgeX, ayirY - badgeH * 0.20, { width: badgeW, align: 'center' });

    cy = ayirY + ikonR + w * 0.045;

    // ---- QR (lacivert) ----
    const bosluk = okutY - cy - w * 0.02;
    const qrSize = Math.min(w * 0.78, bosluk);
    const qrY = cy + (bosluk - qrSize) / 2;
    const qr = await this.qrBuffer(code, NAVY);
    doc.image(qr, cx - qrSize / 2, qrY, { width: qrSize, height: qrSize });

    // ---- QR'I OKUT ----
    doc.fillColor(NAVY).font(FONT_BOLD).fontSize(okutSize)
      .text("QR'I OKUT", x, okutY, { width: w, align: 'center' });

    // ---- ARAC SAHIBINE ULAS ----
    doc.fillColor(NAVY).font(FONT_BOLD).fontSize(altBaslikSize)
      .text('ARAÇ SAHİBİNE ULAŞ', x, altBaslikY, { width: w, align: 'center' });

    // ---- Yesil tik + Uygulama gerekmez ----
    const tikMetin = 'Uygulama gerekmez';
    doc.font(FONT_BOLD).fontSize(tikSize);
    const tikTw = doc.widthOfString(tikMetin);
    const daireR = tikSize * 0.62;
    const grupW = daireR * 2 + w * 0.022 + tikTw;
    const gx = cx - grupW / 2;
    doc.circle(gx + daireR, tikY + tikSize * 0.42, daireR).fill('#16A34A');
    // tik isareti
    doc.save();
    doc.lineWidth(daireR * 0.30).lineCap('round')
      .moveTo(gx + daireR * 0.58, tikY + tikSize * 0.44)
      .lineTo(gx + daireR * 0.88, tikY + tikSize * 0.70)
      .lineTo(gx + daireR * 1.45, tikY + tikSize * 0.12)
      .stroke('#FFFFFF');
    doc.restore();
    doc.fillColor(NAVY).font(FONT_BOLD).fontSize(tikSize)
      .text(tikMetin, gx + daireR * 2 + w * 0.022, tikY, { lineBreak: false });

    // ---- Kirmizi ayirici ----
    doc.moveTo(x + pad * 0.85, kirmiziY).lineTo(x + w - pad * 0.85, kirmiziY)
      .lineWidth(w * 0.008).stroke(RED);

    // ---- Site adresi ----
    doc.fillColor(NAVY).font(FONT_BOLD).fontSize(siteSize)
      .text('mobildiafon.com/auto', x, siteY, { width: w, align: 'center' });

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
    const stW = 55 * MM, stH = 75 * MM;   // sticker 55x75mm
    const gap = 4 * MM;              // stickerlar arasi
    const slipH = 16 * MM;
    const blokW = stW * 2 + gap;
    const blokH = stH + 4 * MM + slipH;

    const cols = 1, rows = 2, perPage = cols * rows;
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


  /** Kurulum kilavuzu: A4'e 12 serit (95x45mm), cift tarafli TR/EN */
  async generateManual(adet = 12): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A4', margin: 0 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));

    const MM = 2.8346;
    const NAVY = '#1B2A4A';
    const sW = 95 * MM, sH = 45 * MM;
    const cols = 2, rows = 6, perPage = cols * rows;
    const pageW = 595.28, pageH = 841.89;
    const gapX = 6 * MM, gapY = 3 * MM;
    const totalW = sW * cols + gapX;
    const totalH = sH * rows + gapY * (rows - 1);
    const offX = (pageW - totalW) / 2;
    const offY = (pageH - totalH) / 2;

    // Indirme QR'i: magaza linki DEGIL, kendi sayfamiz.
    // Kagit basildiktan sonra hedef degistirilebilsin diye.
    const indirQr = await this.qrRaw('https://mobildiafon.com/indir', NAVY);
    const qrS = 15 * MM;

    const ciz = (x: number, y: number, dil: 'tr' | 'en') => {
      doc.roundedRect(x, y, sW, sH, 4).lineWidth(0.4).dash(2, { space: 2 }).stroke('#C8CDD3');
      doc.undash();

      const pad = 5 * MM;
      let cy = y + pad * 0.85;

      doc.font(FONT_BOLD).fontSize(11);
      const wM = doc.widthOfString('Mobil');
      doc.fillColor(NAVY).text('Mobil', x + pad, cy, { lineBreak: false });
      doc.fillColor(RED).text('Diafon', x + pad + wM, cy, { lineBreak: false });
      const wD = doc.widthOfString('Diafon');
      doc.roundedRect(x + pad + wM + wD + 4, cy + 1, 24, 9, 4.5).fill(RED);
      doc.fillColor('#FFFFFF').font(FONT_BOLD).fontSize(5.5)
        .text('AUTO', x + pad + wM + wD + 4, cy + 2.5, { width: 24, align: 'center' });

      doc.fillColor('#8A929C').font(FONT_REG).fontSize(6)
        .text(dil === 'tr' ? 'Kurulum Kılavuzu' : 'Setup Guide',
          x + sW - pad - 70, cy + 3, { width: 70, align: 'right' });

      cy += 15;
      doc.moveTo(x + pad, cy).lineTo(x + sW - pad, cy).lineWidth(0.5).stroke('#E2E6EB');
      cy += 7;

      const qrX = x + sW - pad - qrS;
      const qrY = cy;
      doc.image(indirQr, qrX, qrY, { width: qrS, height: qrS });
      doc.fillColor('#8A929C').font(FONT_REG).fontSize(5)
        .text(dil === 'tr' ? 'Uygulamayı indir' : 'Download the app',
          qrX - 6, qrY + qrS + 2, { width: qrS + 12, align: 'center' });

      const metinW = sW - pad * 2 - 11 - qrS - 6;

      const adimlar: [string, string][] = dil === 'tr'
        ? [
            ['1', 'Uygulamayı indirin, telefon numaranızla giriş yapın.'],
            ['2', 'Araçlarım → Araç Ekle. Önce etiketi okutun, sonra karttaki aktivasyon kodunu ve e-posta adresinizi girin.'],
            ['3', 'Camı temizleyin, etiketi dıştan okunacak şekilde yapıştırın.'],
          ]
        : [
            ['1', 'Download the app and sign in with your phone number.'],
            ['2', 'My Vehicles → Add Vehicle. Scan the sticker first, then enter the activation code from the card and your e-mail.'],
            ['3', 'Clean the glass, apply the sticker facing outward.'],
          ];

      for (const [no, metin] of adimlar) {
        const r = 4;
        doc.circle(x + pad + r, cy + r, r).fill(NAVY);
        doc.fillColor('#FFFFFF').font(FONT_BOLD).fontSize(5.5);
        const hNo = doc.heightOfString(no, { width: r * 2 });
        doc.text(no, x + pad, cy + r - hNo / 2, { width: r * 2, align: 'center', lineBreak: false });
        doc.fillColor('#2B3442').font(FONT_REG).fontSize(6.2)
          .text(metin, x + pad + 11, cy, { width: metinW, lineGap: 0.5 });
        cy += 13.5;
      }

      cy = y + sH - pad - 26;
      doc.moveTo(x + pad, cy).lineTo(x + sW - pad, cy).lineWidth(0.5).stroke('#E2E6EB');
      cy += 4;

      doc.fillColor('#6B7280').font(FONT_REG).fontSize(5.4)
        .text(
          dil === 'tr'
            ? 'Kutuda 2 etiket vardır, biri yedektir. Aktivasyon kartınızı saklayın. Numaranız değişirse kayıtlı e-postanızla hesabınıza ulaşabilirsiniz.'
            : 'The box contains 2 stickers, one is a spare. Keep your activation card. If your number changes, you can recover your account with your e-mail.',
          x + pad, cy, { width: sW - pad * 2, lineGap: 0.3 },
        );

      doc.fillColor(NAVY).font(FONT_BOLD).fontSize(6.2)
        .text('mobildiafon.com/auto', x + pad, y + sH - pad * 0.9 - 6, { lineBreak: false });
      doc.fillColor('#9AA3AD').font(FONT_REG).fontSize(5.6)
        .text('info@mobildiafon.com', x + sW - pad - 80, y + sH - pad * 0.9 - 6,
          { width: 80, align: 'right' });
    };

    const sayfaSayisi = Math.ceil(adet / perPage);
    for (let s = 0; s < sayfaSayisi; s++) {
      if (s > 0) doc.addPage({ size: 'A4', margin: 0 });
      for (let i = 0; i < perPage; i++) {
        const col = i % cols, row = Math.floor(i / cols);
        ciz(offX + col * (sW + gapX), offY + row * (sH + gapY), 'tr');
      }
      doc.addPage({ size: 'A4', margin: 0 });
      for (let i = 0; i < perPage; i++) {
        const col = i % cols, row = Math.floor(i / cols);
        const aynaCol = cols - 1 - col;
        ciz(offX + aynaCol * (sW + gapX), offY + row * (sH + gapY), 'en');
      }
    }

    doc.end();
    return new Promise((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
    });
  }



  /** Sadece aktivasyon kodu karti. QR ile bagi YOK. A4'e 12 adet (95x45mm). */
  async generateSecretCards(secrets: string[]): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A4', margin: 0 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));

    const pageW = 595.28, pageH = 841.89;
    const MM = 2.8346;
    const cardW = 95 * MM, cardH = 45 * MM;
    const cols = 2, rows = 6, perPage = cols * rows;
    const colGap = 4 * MM, rowGap = 2 * MM;
    const totalW = cardW * cols + colGap;
    const totalH = cardH * rows + rowGap * (rows - 1);
    const offX = (pageW - totalW) / 2;
    const offY = (pageH - totalH) / 2;

    for (let i = 0; i < secrets.length; i++) {
      if (i > 0 && i % perPage === 0) doc.addPage({ size: 'A4', margin: 0 });
      const idx = i % perPage;
      const x = offX + (idx % cols) * (cardW + colGap);
      const y = offY + Math.floor(idx / cols) * (cardH + rowGap);

      doc.roundedRect(x, y, cardW, cardH, 4).lineWidth(0.5).dash(2, { space: 2 }).stroke('#B0B8C1');
      doc.undash();

      let cy = y + cardH * 0.16;
      doc.fillColor('#5A6470').font(FONT_REG).fontSize(8)
        .text('AKTİVASYON KODU', x, cy, { width: cardW, align: 'center' });
      cy += 14;
      doc.fillColor('#111827').font(FONT_MONO).fontSize(20)
        .text(secrets[i] || '-', x, cy, { width: cardW, align: 'center' });
      cy += 26;
      doc.fillColor('#5A6470').font(FONT_REG).fontSize(7)
        .text('Bu karti saklayin · mobildiafon.com', x, cy, { width: cardW, align: 'center' });

      this.cropMark(doc, x, y);
      this.cropMark(doc, x + cardW, y);
      this.cropMark(doc, x, y + cardH);
      this.cropMark(doc, x + cardW, y + cardH);
    }

    doc.end();
    return new Promise((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
    });
  }

  /** Sadece QR sticker. Her kod icin 2 ayni etiket. A4'e 2 blok. */
  async generateStickerSheet(codes: string[]): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A4', margin: 0 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));

    const pageW = 595.28, pageH = 841.89;
    const MM = 2.8346;
    const stW = 55 * MM, stH = 75 * MM;
    const gap = 4 * MM;
    const blokW = stW * 2 + gap;
    const rows = 2, perPage = rows;
    const rowGap = 6 * MM;
    const offX = (pageW - blokW) / 2;
    const offY = (pageH - (stH * rows + rowGap)) / 2;

    for (let i = 0; i < codes.length; i++) {
      if (i > 0 && i % perPage === 0) doc.addPage({ size: 'A4', margin: 0 });
      const idx = i % perPage;
      const bx = offX;
      const by = offY + idx * (stH + rowGap);
      const sira = String(i + 1).padStart(4, '0');

      await this.drawSticker(doc, codes[i], bx, by, stW, stH, sira);
      await this.drawSticker(doc, codes[i], bx + stW + gap, by, stW, stH, sira);

      this.cropMark(doc, bx, by);
      this.cropMark(doc, bx + stW, by);
      this.cropMark(doc, bx + stW + gap, by);
      this.cropMark(doc, bx + blokW, by);
      this.cropMark(doc, bx, by + stH);
      this.cropMark(doc, bx + blokW, by + stH);
    }

    doc.end();
    return new Promise((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
    });
  }

}
