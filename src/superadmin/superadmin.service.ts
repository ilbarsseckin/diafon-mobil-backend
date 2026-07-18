import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

function pricePerFlat(count: number): number {
  if (count <= 20) return 15;
  if (count <= 60) return 13;
  if (count <= 150) return 11;
  return 9;
}

@Injectable()
export class SuperadminService {
  constructor(private prisma: PrismaService, private mail: MailService) {}

  // Genel bakis: KPI + grafik verileri
  async overview() {
    const { customers } = await this.customers();
    const active = customers.filter((c: any) => c.status === 'active');
    const mrr = active.reduce((s: number, c: any) => s + c.mrr, 0);

    // Son 12 ay yeni kayit (signups) - User.createdAt'tan
    const now = new Date();
    const months: string[] = [];
    const signups: number[] = [];
    const revenue: number[] = [];
    const allUsers = await this.prisma.user.findMany({ select: { createdAt: true } });
    const monthNames = ['Oca','Sub','Mar','Nis','May','Haz','Tem','Agu','Eyl','Eki','Kas','Ara'];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const next = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      months.push(monthNames[d.getMonth()]);
      signups.push(allUsers.filter(u => u.createdAt >= d && u.createdAt < next).length);
      // Gelir: basit - su anki MRR'i son aya koy, oncekiler kademeli (gercek gecmis yok)
      revenue.push(i === 0 ? mrr / 1000 : 0);
    }

    // Plan dagilimi (scopeType bazli: site/bireysel) - subscription'lardan
    const subs = await this.prisma.subscription.findMany();
    const siteCount = subs.filter(s => s.scopeType === 'site').length;
    const indCount = subs.filter(s => s.scopeType === 'individual').length;

    return {
      kpi: {
        total: customers.length,
        active: active.length,
        trial: customers.filter((c: any) => c.status === 'trial').length,
        cancelled: customers.filter((c: any) => c.status === 'cancelled').length,
        mrr,
        buildings: customers.reduce((s: number, c: any) => s + c.buildings, 0),
        flats: customers.reduce((s: number, c: any) => s + c.flats, 0),
        calls: customers.reduce((s: number, c: any) => s + c.calls, 0),
      },
      months,
      signups,
      revenue,
      plans: { site: siteCount, individual: indCount },
    };
  }

  // Bir owner'in tum aboneliklerini ucretsiz (sinirsiz aktif) yap / geri al
  async setFree(ownerId: string, free: boolean) {
    if (!ownerId) return { success: false, message: 'ownerId gerekli' };
    if (free) {
      const farFuture = new Date('2099-12-31');
      await this.prisma.subscription.updateMany({
        where: { ownerUserId: ownerId },
        data: { status: 'active', monthlyPrice: 0, currentPeriodEnd: farFuture, trialEndsAt: farFuture },
      });
      await this.prisma.user.update({ where: { id: ownerId }, data: { isPremium: true } });
      return { success: true, message: 'Hesap ucretsiz (sinirsiz) yapildi' };
    } else {
      // Geri al: trial'a dondur (14 gun)
      const trialEnd = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
      await this.prisma.subscription.updateMany({
        where: { ownerUserId: ownerId },
        data: { status: 'trial', trialEndsAt: trialEnd, currentPeriodEnd: trialEnd },
      });
      return { success: true, message: 'Ucretsizlik kaldirildi' };
    }
  }

  // Tum musteriler (yoneticiler) + metrikleri
  async customers() {
    // Bina sahibi olan tum kullanicilar = musteriler
    const buildings = await this.prisma.building.findMany();
    const ownerIds = [...new Set(buildings.map(b => b.ownerUserId).filter(Boolean))] as string[];
    if (ownerIds.length === 0) return { customers: [] };

    const owners = await this.prisma.user.findMany({ where: { id: { in: ownerIds } } });
    const subs = await this.prisma.subscription.findMany({ where: { ownerUserId: { in: ownerIds } } });

    const customers: any[] = [];
    for (const owner of owners) {
      const ownerBuildings = buildings.filter(b => b.ownerUserId === owner.id);
      const buildingIds = ownerBuildings.map(b => b.id);
      const flatCount = await this.prisma.apartment.count({ where: { buildingId: { in: buildingIds } } });
      const residentCount = await this.prisma.resident.count({ where: { approved: true, apartment: { buildingId: { in: buildingIds } } } });
      const callCount = await this.prisma.call.count({ where: { buildingId: { in: buildingIds } } });

      // Bu owner'in abonelikleri -> MRR ve durum
      const ownerSubs = subs.filter(s => s.ownerUserId === owner.id);
      let mrr = 0;
      let status = 'trial';
      for (const s of ownerSubs) {
        if (s.status === 'active') { mrr += s.monthlyPrice; status = 'active'; }
        else if (s.status === 'trial' && status !== 'active') status = 'trial';
        else if (s.status === 'expired' && status === 'trial') status = 'cancelled';
      }
      // Hic abonelik yoksa deneme varsay
      if (ownerSubs.length === 0) status = 'trial';

      // Site adi (varsa) yoksa ilk bina adi
      const siteName = ownerBuildings.find(b => b.siteName)?.siteName || ownerBuildings[0]?.buildingName || 'Bilinmeyen';

      const isFree = ownerSubs.length > 0 && ownerSubs.every(s => s.status === 'active' && s.monthlyPrice === 0);
      customers.push({
        id: owner.id,
        name: siteName,
        owner: owner.name,
        phone: owner.phone,
        status,
        isFree,
        buildings: ownerBuildings.length,
        flats: flatCount,
        residents: residentCount,
        calls: callCount,
        mrr,
        since: owner.createdAt,
      });
    }
    return { customers };
  }

  // Tum isletmeler (type='business') - Isletmeler sekmesi
  async businesses() {
    const bldgs = await this.prisma.building.findMany({
      where: { type: 'business' },
      orderBy: { createdAt: 'desc' },
    });
    if (bldgs.length === 0) return { businesses: [] };

    const ownerIds = [...new Set(bldgs.map(b => b.ownerUserId).filter(Boolean))] as string[];
    const owners = await this.prisma.user.findMany({ where: { id: { in: ownerIds } } });
    const ownerMap = new Map(owners.map(o => [o.id, o]));

    const businesses = await Promise.all(
      bldgs.map(async (b) => {
        const owner = b.ownerUserId ? ownerMap.get(b.ownerUserId) : null;
        const callCount = await this.prisma.call.count({ where: { buildingId: b.id } });
        const unitCount = await this.prisma.apartment.count({ where: { buildingId: b.id } });
        return {
          id: b.id,
          name: b.buildingName,
          category: b.businessCategory || '-',
          owner: owner?.name || 'Bilinmeyen',
          phone: owner?.phone || '',
          address: b.address || '',
          latitude: b.latitude,
          longitude: b.longitude,
          units: unitCount,
          calls: callCount,
          qrToken: b.qrToken,
          since: b.createdAt,
        };
      })
    );
    return { businesses };
  }


  // ---- FATURALAR ----
  async invoices() {
    const list = await this.prisma.invoice.findMany({ orderBy: { createdAt: 'desc' } });
    if (list.length === 0) return { invoices: [] };
    const ownerIds = [...new Set(list.map(i => i.ownerUserId).filter(Boolean))] as string[];
    const owners = await this.prisma.user.findMany({ where: { id: { in: ownerIds } } });
    const om = new Map(owners.map(o => [o.id, o]));
    const invoices = list.map(i => {
      const o = om.get(i.ownerUserId);
      return {
        id: i.id,
        ownerUserId: i.ownerUserId,
        owner: o?.name || 'Bilinmeyen',
        phone: o?.phone || '',
        email: o?.email || '',
        title: i.title || '',
        amount: i.amount || 0,
        paymentStatus: i.paymentStatus,
        fileUrl: i.fileUrl || '',
        uploaded: !!i.uploadedAt,
        sent: !!i.sentAt,
        sentAt: i.sentAt,
        createdAt: i.createdAt,
      };
    });
    return { invoices };
  }

  async createInvoice(dto: { ownerUserId: string; title?: string; amount?: number; buildingId?: string; vehicleId?: string; note?: string }) {
    if (!dto.ownerUserId) return { success: false, message: 'Owner gerekli' };
    const owner = await this.prisma.user.findUnique({ where: { id: dto.ownerUserId } });
    if (!owner) return { success: false, message: 'Owner bulunamadi' };
    const inv = await this.prisma.invoice.create({
      data: {
        ownerUserId: dto.ownerUserId,
        title: dto.title || null,
        amount: dto.amount ?? null,
        buildingId: dto.buildingId || null,
        vehicleId: dto.vehicleId || null,
        note: dto.note || null,
      },
    });
    return { success: true, id: inv.id };
  }

  async markInvoicePaid(id: string, paid: boolean) {
    const inv = await this.prisma.invoice.findUnique({ where: { id } });
    if (!inv) return { success: false, message: 'Fatura bulunamadi' };
    await this.prisma.invoice.update({ where: { id }, data: { paymentStatus: paid ? 'paid' : 'pending' } });
    return { success: true };
  }

  async sendInvoiceMail(id: string) {
    const inv = await this.prisma.invoice.findUnique({ where: { id } });
    if (!inv) return { success: false, message: 'Fatura bulunamadi' };
    if (!inv.fileUrl) return { success: false, message: 'Once PDF yukleyin' };
    const owner = await this.prisma.user.findUnique({ where: { id: inv.ownerUserId } });
    if (!owner) return { success: false, message: 'Owner bulunamadi' };
    if (!owner.email) return { success: false, message: 'Owner\'in mail adresi yok' };
    const ok = await this.mail.sendInvoice(owner.email, owner.name, inv.fileUrl, inv.title || undefined);
    if (!ok) return { success: false, message: 'Mail gonderilemedi' };
    await this.prisma.invoice.update({ where: { id }, data: { sentAt: new Date() } });
    return { success: true };
  }


  async uploadInvoiceFile(id: string, base64: string) {
    const inv = await this.prisma.invoice.findUnique({ where: { id } });
    if (!inv) return { success: false, message: 'Fatura bulunamadi' };
    const fs = require('fs');
    const path = require('path');
    const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    const clean = base64.replace(/^data:application\/pdf;base64,/, '').replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(clean, 'base64');
    const filename = `invoice_${id}_${Date.now()}.pdf`;
    fs.writeFileSync(path.join(uploadsDir, filename), buffer);
    const url = `/uploads/${filename}`;
    await this.prisma.invoice.update({ where: { id }, data: { fileUrl: url, uploadedAt: new Date() } });
    return { success: true, url };
  }


  /** Tum lokasyonlar: bina/isletme, sahibi, abonelik durumu, fatura ozeti */
  async locations() {
    const locs = await this.prisma.location.findMany({ orderBy: { createdAt: 'desc' } });
    const result: any[] = [];

    for (const l of locs) {
      const buildings = await this.prisma.building.findMany({
        where: { locationId: l.id },
        select: { id: true, buildingName: true, blockName: true },
        orderBy: { createdAt: 'asc' },
      });
      let unitCount = 0;
      for (const b of buildings) {
        unitCount += await this.prisma.apartment.count({ where: { buildingId: b.id } });
      }

      const owner = l.ownerUserId
        ? await this.prisma.user.findUnique({
            where: { id: l.ownerUserId },
            select: { id: true, name: true, phone: true, email: true },
          })
        : null;

      const sub = await this.prisma.subscription.findFirst({
        where: { locationId: l.id },
        orderBy: { createdAt: 'desc' },
      });

      let daysLeft = 0;
      if (sub) {
        const end = sub.status === 'trial' ? sub.trialEndsAt : sub.currentPeriodEnd;
        if (end) daysLeft = Math.max(0, Math.ceil((new Date(end).getTime() - Date.now()) / 86400000));
      }

      const unpaidInvoices = l.ownerUserId
        ? await this.prisma.invoice.count({
            where: { ownerUserId: l.ownerUserId, paymentStatus: { not: 'paid' } },
          })
        : 0;

      result.push({
        id: l.id,
        name: l.name,
        type: l.type,
        businessCategory: l.businessCategory,
        address: l.address,
        latitude: l.latitude,
        longitude: l.longitude,
        createdAt: l.createdAt,
        ownerId: owner?.id || null,
        ownerName: owner?.name || null,
        ownerPhone: owner?.phone || null,
        ownerEmail: owner?.email || null,
        blockCount: buildings.length,
        unitCount,
        blocks: buildings.map((b) => ({ id: b.id, name: b.blockName || b.buildingName })),
        subscription: sub
          ? {
              id: sub.id,
              status: sub.status,
              daysLeft,
              monthlyPrice: sub.monthlyPrice,
              periodEnd: sub.status === 'trial' ? sub.trialEndsAt : sub.currentPeriodEnd,
            }
          : null,
        unpaidInvoices,
      });
    }
    return result;
  }


  /** Tek lokasyonun tum detayi: bloklar, sakinler, faturalar, abonelik */
  async locationDetail(id: string) {
    const l = await this.prisma.location.findUnique({ where: { id } });
    if (!l) return { success: false, message: 'Lokasyon bulunamadi' };

    const owner = l.ownerUserId
      ? await this.prisma.user.findUnique({
          where: { id: l.ownerUserId },
          select: { id: true, name: true, phone: true, email: true, createdAt: true },
        })
      : null;

    const buildings = await this.prisma.building.findMany({
      where: { locationId: id },
      orderBy: { createdAt: 'asc' },
    });

    const bloklar: any[] = [];
    let unitCount = 0;
    let residentCount = 0;
    for (const b of buildings) {
      const apts = await this.prisma.apartment.findMany({
        where: { buildingId: b.id },
        select: { id: true },
      });
      unitCount += apts.length;
      const rc = apts.length
        ? await this.prisma.resident.count({ where: { apartmentId: { in: apts.map((a) => a.id) } } })
        : 0;
      residentCount += rc;
      bloklar.push({
        id: b.id,
        name: b.blockName || b.buildingName,
        fullName: b.buildingName,
        qrToken: b.qrToken,
        unitCount: apts.length,
        residentCount: rc,
        requireApproval: b.requireApproval,
      });
    }

    const sub = await this.prisma.subscription.findFirst({
      where: { locationId: id },
      orderBy: { createdAt: 'desc' },
    });
    let daysLeft = 0;
    if (sub) {
      const end = sub.status === 'trial' ? sub.trialEndsAt : sub.currentPeriodEnd;
      if (end) daysLeft = Math.max(0, Math.ceil((new Date(end).getTime() - Date.now()) / 86400000));
    }

    const invoices = l.ownerUserId
      ? await this.prisma.invoice.findMany({
          where: { ownerUserId: l.ownerUserId },
          orderBy: { createdAt: 'desc' },
          take: 20,
        })
      : [];

    // Son cagrilar
    const callCount = buildings.length
      ? await this.prisma.call.count({ where: { buildingId: { in: buildings.map((b) => b.id) } } })
      : 0;

    return {
      success: true,
      id: l.id,
      name: l.name,
      type: l.type,
      businessCategory: l.businessCategory,
      address: l.address,
      latitude: l.latitude,
      longitude: l.longitude,
      createdAt: l.createdAt,
      owner,
      blocks: bloklar,
      blockCount: bloklar.length,
      unitCount,
      residentCount,
      callCount,
      subscription: sub
        ? {
            id: sub.id,
            status: sub.status,
            daysLeft,
            monthlyPrice: sub.monthlyPrice,
            flatCount: sub.flatCount,
            plan: sub.plan,
            trialEndsAt: sub.trialEndsAt,
            currentPeriodEnd: sub.currentPeriodEnd,
          }
        : null,
      invoices: invoices.map((i) => ({
        id: i.id,
        title: i.title,
        amount: i.amount,
        paymentStatus: i.paymentStatus,
        sentAt: i.sentAt,
        fileUrl: i.fileUrl,
        createdAt: i.createdAt,
      })),
    };
  }


  /** Musteriler: lokasyon veya arac sahibi olan kullanicilar */
  async owners() {
    const users = await this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, phone: true, email: true, createdAt: true, blocked: true },
    });

    const result: any[] = [];
    for (const u of users) {
      const locs = await this.prisma.location.findMany({
        where: { ownerUserId: u.id },
        select: { id: true, name: true, type: true },
      });
      const vehicles = await this.prisma.vehicle.findMany({
        where: { ownerUserId: u.id },
        select: { id: true, code: true, plate: true, label: true, status: true },
      });

      // Sadece sahibi olanlar musteri sayilir
      if (locs.length === 0 && vehicles.length === 0) continue;

      const subs = await this.prisma.subscription.findMany({
        where: { ownerUserId: u.id },
        orderBy: { createdAt: 'desc' },
      });
      const now = Date.now();
      const varliklar: any[] = [];
      let aylikToplam = 0;

      for (const l of locs) {
        const s = subs.find((x) => x.locationId === l.id);
        let daysLeft = 0;
        if (s) {
          const end = s.status === 'trial' ? s.trialEndsAt : s.currentPeriodEnd;
          if (end) daysLeft = Math.max(0, Math.ceil((new Date(end).getTime() - now) / 86400000));
          aylikToplam += s.monthlyPrice || 0;
        }
        varliklar.push({
          kind: 'location', id: l.id, name: l.name,
          type: l.type === 'business' ? 'Isletme' : 'Apartman',
          status: s?.status || null, daysLeft, monthlyPrice: s?.monthlyPrice || 0,
        });
      }

      for (const v of vehicles) {
        const s = subs.find((x) => x.vehicleId === v.id);
        let daysLeft = 0;
        if (s?.currentPeriodEnd) {
          daysLeft = Math.max(0, Math.ceil((new Date(s.currentPeriodEnd).getTime() - now) / 86400000));
        }
        varliklar.push({
          kind: 'vehicle', id: v.id, name: v.plate || v.label || v.code,
          type: 'Arac', status: s?.status || v.status, daysLeft, monthlyPrice: s?.monthlyPrice || 0,
        });
      }

      const unpaid = await this.prisma.invoice.count({
        where: { ownerUserId: u.id, paymentStatus: { not: 'paid' } },
      });

      result.push({
        id: u.id, name: u.name, phone: u.phone, email: u.email,
        createdAt: u.createdAt, blocked: u.blocked,
        assets: varliklar,
        assetCount: varliklar.length,
        locationCount: locs.length,
        vehicleCount: vehicles.length,
        monthlyTotal: aylikToplam,
        unpaidInvoices: unpaid,
      });
    }
    return result;
  }

}
