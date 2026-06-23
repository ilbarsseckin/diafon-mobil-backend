import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TuyaAdapter } from './adapters/tuya.adapter';
import { DoorAdapter } from './adapters/door-adapter.interface';

@Injectable()
export class DoorService {
  private readonly logger = new Logger('DoorService');
  private lastOpen = new Map<string, number>();
  private readonly minIntervalMs = 3000;

  constructor(private prisma: PrismaService, private tuya: TuyaAdapter) {}

  private getAdapter(adapter: string): DoorAdapter | null {
    if (adapter === 'tuya') return this.tuya;
    return null;
  }

  // Kullanici bu binada yetkili mi? (onayli sakin veya bina sahibi)
  private async isAuthorized(userId: string, buildingId: string): Promise<boolean> {
    const building = await this.prisma.building.findUnique({ where: { id: buildingId } });
    if (!building) return false;
    if (building.ownerUserId === userId) return true;
    const resident = await this.prisma.resident.findFirst({
      where: { userId, approved: true, apartment: { buildingId } },
    });
    return !!resident;
  }

  // Binanin aktif kapilari (yetkili kullanici icin)
  async listDoors(userId: string, buildingId: string) {
    if (!(await this.isAuthorized(userId, buildingId))) {
      throw new Error('Bu bina icin yetkiniz yok');
    }
    const doors = await this.prisma.door.findMany({
      where: { buildingId, enabled: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, name: true },
    });
    return doors;
  }

  // Belirli kapiyi ac
  async openDoor(userId: string, doorId: string, callId: string | null, ip: string | null) {
    const last = this.lastOpen.get(userId) || 0;
    if (Date.now() - last < this.minIntervalMs) {
      throw new Error('Cok sik deneme, lutfen bekleyin');
    }

    const door = await this.prisma.door.findUnique({ where: { id: doorId } });
    if (!door || !door.enabled) throw new Error('Kapi bulunamadi');

    if (!(await this.isAuthorized(userId, door.buildingId))) {
      await this.log(userId, door.buildingId, doorId, callId, false, 'Yetki yok', ip);
      throw new Error('Bu kapi icin yetkiniz yok');
    }

    const adapter = this.getAdapter(door.adapter);
    if (!adapter) {
      await this.log(userId, door.buildingId, doorId, callId, false, 'Adapter yok: ' + door.adapter, ip);
      throw new Error('Kapi sistemi desteklenmiyor');
    }

    this.lastOpen.set(userId, Date.now());
    try {
      await adapter.open(door.deviceId);
      await this.log(userId, door.buildingId, doorId, callId, true, null, ip);
      return { success: true };
    } catch (e: any) {
      await this.log(userId, door.buildingId, doorId, callId, false, e.message || 'hata', ip);
      throw new Error(e.message || 'Kapi acilamadi');
    }
  }

  private async log(userId: string, buildingId: string, doorId: string | null, callId: string | null, success: boolean, error: string | null, ip: string | null) {
    try {
      await this.prisma.doorLog.create({
        data: { userId, buildingId, doorId, callId, success, error, ip },
      });
    } catch (e) {
      this.logger.error('Door log yazilamadi: ' + e);
    }
  }
}
