import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TuyaAdapter } from './adapters/tuya.adapter';
import { DoorAdapter } from './adapters/door-adapter.interface';

@Injectable()
export class DoorService {
  private readonly logger = new Logger('DoorService');
  // Basit rate limit: userId -> son acma zamani (ms)
  private lastOpen = new Map<string, number>();
  private readonly minIntervalMs = 3000; // 3sn icinde tekrar acma engeli

  constructor(
    private prisma: PrismaService,
    private tuya: TuyaAdapter,
  ) {}

  // Adapter secimi (ileride iprole/esp32 eklenince burada genisler)
  private getAdapter(adapter: string | null): DoorAdapter | null {
    if (adapter === 'tuya') return this.tuya;
    return null;
  }

  // Kapiyi ac: yetki + cihaz + rate limit + log
  async openDoor(userId: string, buildingId: string, callId: string | null, ip: string | null) {
    // Rate limit
    const last = this.lastOpen.get(userId) || 0;
    if (Date.now() - last < this.minIntervalMs) {
      throw new Error('Cok sik deneme, lutfen bekleyin');
    }

    // Bina + kapi yapilandirmasi
    const building = await this.prisma.building.findUnique({ where: { id: buildingId } });
    if (!building) throw new Error('Bina bulunamadi');
    if (!building.doorEnabled || !building.doorAdapter || !building.doorDeviceId) {
      throw new Error('Bu bina icin kapi acma aktif degil');
    }

    // Yetki: kullanici bu binada onayli sakin mi? (veya bina sahibi)
    const isOwner = building.ownerUserId === userId;
    let authorized = isOwner;
    if (!authorized) {
      const resident = await this.prisma.resident.findFirst({
        where: { userId, approved: true, apartment: { buildingId } },
      });
      authorized = !!resident;
    }
    if (!authorized) {
      await this.log(userId, buildingId, callId, false, 'Yetki yok', ip);
      throw new Error('Bu bina icin kapi acma yetkiniz yok');
    }

    // Adapter
    const adapter = this.getAdapter(building.doorAdapter);
    if (!adapter) {
      await this.log(userId, buildingId, callId, false, 'Adapter yok: ' + building.doorAdapter, ip);
      throw new Error('Kapi sistemi desteklenmiyor');
    }

    // Ac
    this.lastOpen.set(userId, Date.now());
    try {
      await adapter.open(building.doorDeviceId);
      await this.log(userId, buildingId, callId, true, null, ip);
      return { success: true };
    } catch (e: any) {
      await this.log(userId, buildingId, callId, false, e.message || 'hata', ip);
      throw new Error(e.message || 'Kapi acilamadi');
    }
  }

  private async log(userId: string, buildingId: string, callId: string | null, success: boolean, error: string | null, ip: string | null) {
    try {
      await this.prisma.doorLog.create({
        data: { userId, buildingId, callId, success, error, ip },
      });
    } catch (e) {
      this.logger.error('Door log yazilamadi: ' + e);
    }
  }
}
