import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SiteTextsService {
  constructor(private prisma: PrismaService) {}

  // Tum metinleri key -> {tr, en} formatinda dondur
  async getAll() {
    const rows = await this.prisma.siteText.findMany();
    const map: Record<string, { tr: string; en: string }> = {};
    for (const r of rows) {
      map[r.key] = { tr: r.valueTr, en: r.valueEn };
    }
    return map;
  }

  // Toplu guncelle: [{key, valueTr, valueEn}]
  async updateMany(items: { key: string; valueTr: string; valueEn: string }[]) {
    for (const it of items) {
      if (!it.key) continue;
      await this.prisma.siteText.upsert({
        where: { key: it.key },
        update: { valueTr: it.valueTr ?? '', valueEn: it.valueEn ?? '' },
        create: { key: it.key, valueTr: it.valueTr ?? '', valueEn: it.valueEn ?? '' },
      });
    }
    return { message: 'Metinler guncellendi', count: items.length };
  }
}
