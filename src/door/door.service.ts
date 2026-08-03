import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);
import * as fs from 'fs';
import { PrismaService } from '../prisma/prisma.service';
import { TuyaAdapter } from './adapters/tuya.adapter';
import { ShellyMqttAdapter } from './adapters/shelly-mqtt.adapter';
import { SubscriptionGateService } from '../subscription/subscription-gate.service';
import { DoorAdapter } from './adapters/door-adapter.interface';

@Injectable()
export class DoorService {
  private readonly logger = new Logger('DoorService');
  private lastOpen = new Map<string, number>();
  private readonly minIntervalMs = 3000;

  constructor(
    private prisma: PrismaService,
    private tuya: TuyaAdapter,
    private shelly: ShellyMqttAdapter,
    private gate: SubscriptionGateService,
  ) {}

  private getAdapter(adapter: string): DoorAdapter | null {
    if (adapter === 'tuya') return this.tuya;
    if (adapter === 'shelly') return this.shelly;
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
      select: { id: true, name: true, adapter: true, deviceId: true, pulseSeconds: true },
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

    const gate = await this.gate.canServeBuilding(door.buildingId);
    if (!gate.ok) {
      await this.log(userId, door.buildingId, doorId, callId, false, 'Abonelik sona ermis', ip);
      throw new Error(gate.message || 'Abonelik sona ermis');
    }

    const adapter = this.getAdapter(door.adapter);
    if (!adapter) {
      await this.log(userId, door.buildingId, doorId, callId, false, 'Adapter yok: ' + door.adapter, ip);
      throw new Error('Kapi sistemi desteklenmiyor');
    }

    this.lastOpen.set(userId, Date.now());
    try {
      await adapter.open(door.deviceId, door.pulseSeconds || 2);
      await this.log(userId, door.buildingId, doorId, callId, true, null, ip);
      return { success: true };
    } catch (e: any) {
      await this.log(userId, door.buildingId, doorId, callId, false, e.message || 'hata', ip);
      throw new Error(e.message || 'Kapi acilamadi');
    }
  }

  // SHELLY SIHIRBAZI: cihaza ozel MQTT kimligi uretir (sadece bina sahibi)
  async provisionCredentials(userId: string, buildingId: string) {
    const building = await this.prisma.building.findUnique({ where: { id: buildingId } });
    if (!building) throw new Error('Bina bulunamadi');
    if (building.ownerUserId !== userId) throw new Error('Yetki yok');

    const mqttUser = 'dev_' + crypto.randomBytes(6).toString('hex');
    const mqttPassword = crypto.randomBytes(12).toString('base64url');
    const passwdFile = process.env.MQTT_PASSWD_FILE || '/mosquitto-config/passwd';

    try {
      await execAsync(`mosquitto_passwd -b ${passwdFile} ${mqttUser} ${mqttPassword}`);
    } catch (e: any) {
      this.logger.error('mosquitto_passwd hatasi: ' + (e.message || e));
      throw new Error('MQTT kullanicisi olusturulamadi');
    }

    this.logger.log('Yeni MQTT kullanicisi: ' + mqttUser + ' (bina ' + buildingId + ')');
    return {
      mqttServer: process.env.MQTT_PUBLIC_HOST || 'mobildiafon.com:1883',
      mqttUser,
      mqttPassword,
    };
  }

  // SHELLY SIHIRBAZI: cihazi kendi topic'ine kilitle (MQTT ACL)
  // Cagrilmazsa cihaz HICBIR SEY yapamaz (acl_file aktif).
  // mosquitto ACL'i cron ile dakikada bir yeniden okuyor.
  async writeAcl(mqttUser: string, deviceId: string) {
    if (!mqttUser || !deviceId) return;
    const aclFile = process.env.MQTT_ACL_FILE || '/mosquitto-config/acl';
    try {
      const mevcut = await fs.promises.readFile(aclFile, 'utf-8').catch(() => '');
      if (mevcut.includes(`user ${mqttUser}`)) {
        this.logger.log('ACL zaten var: ' + mqttUser);
        return;
      }
      const blok =
        `\n# ${deviceId}\n` +
        `user ${mqttUser}\n` +
        `topic readwrite ${deviceId}/#\n` +
        `topic write diafon-backend/rpc\n`;
      await fs.promises.appendFile(aclFile, blok);
      this.logger.log('ACL yazildi: ' + mqttUser + ' -> ' + deviceId);
    } catch (e: any) {
      this.logger.error('ACL yazilamadi: ' + (e.message || e));
      throw new Error('Cihaz yetkilendirilemedi');
    }
  }

  // Kapinin role suresini degistir (sadece bina sahibi)
  async setDoorPulse(userId: string, doorId: string, saniye: number) {
    const door = await this.prisma.door.findUnique({ where: { id: doorId } });
    if (!door) throw new Error('Kapi bulunamadi');
    const building = await this.prisma.building.findUnique({ where: { id: door.buildingId } });
    if (!building || building.ownerUserId !== userId) throw new Error('Yetki yok');
    if (door.adapter !== 'shelly') throw new Error('Bu kapi tipi sure ayarini desteklemiyor');

    await this.shelly.setPulse(door.deviceId, saniye);
    await this.prisma.door.update({
      where: { id: doorId },
      data: { pulseSeconds: Math.round(saniye) },
    });
    return { success: true, pulseSeconds: saniye };
  }

  // SHELLY SIHIRBAZI: cihaz cevrimici mi
  async verifyDevice(deviceId: string) {
    return this.shelly.verify(deviceId);
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
