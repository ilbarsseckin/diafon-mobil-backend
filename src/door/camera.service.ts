import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const GO2RTC_API = process.env.GO2RTC_API || 'http://127.0.0.1:1984';

@Injectable()
export class CameraService implements OnModuleInit {
  private readonly logger = new Logger('CameraService');
  constructor(private prisma: PrismaService) {}

  // Backend acilista: DB'deki tum aktif kameralari go2rtc'ye yukle (Yol 2 - sync)
  async onModuleInit() {
    try {
      const cams = await this.prisma.building.findMany({
        where: { cameraEnabled: true, cameraRtspUrl: { not: null } },
        select: { id: true, cameraRtspUrl: true, cameraStreamId: true },
      });
      let ok = 0;
      for (const b of cams) {
        const streamId = b.cameraStreamId || this.streamIdFor(b.id);
        const added = await this.addToGo2rtc(streamId, b.cameraRtspUrl as string);
        if (added) ok++;
      }
      this.logger.log(`go2rtc sync: ${ok}/${cams.length} kamera yuklendi`);
    } catch (e: any) {
      this.logger.warn(`go2rtc sync atlandi: ${e?.message || e}`);
    }
  }

  streamIdFor(buildingId: string): string {
    return 'bina_' + buildingId.replace(/-/g, '').slice(0, 16);
  }

  // go2rtc'ye stream ekle (PUT /api/streams?name=X&src=Y)
  async addToGo2rtc(streamId: string, rtspUrl: string): Promise<boolean> {
    try {
      const url =
        `${GO2RTC_API}/api/streams?name=${encodeURIComponent(streamId)}` +
        `&src=${encodeURIComponent(rtspUrl)}`;
      const res = await fetch(url, { method: 'PUT' });
      return res.ok;
    } catch (e: any) {
      this.logger.warn(`go2rtc ekleme hatasi: ${e?.message || e}`);
      return false;
    }
  }

  // go2rtc'den stream sil (DELETE /api/streams?src=X)
  async removeFromGo2rtc(streamId: string): Promise<void> {
    try {
      await fetch(
        `${GO2RTC_API}/api/streams?src=${encodeURIComponent(streamId)}`,
        { method: 'DELETE' },
      );
    } catch (_) {
      // sessiz gec
    }
  }

  // Bir binaya kamera tanimla / guncelle
  async setCamera(
    userId: string,
    buildingId: string,
    rtspUrl: string | null,
    enabled: boolean,
  ) {
    // Yetki: sadece bina sahibi
    const own = await this.prisma.building.findUnique({
      where: { id: buildingId },
      select: { ownerUserId: true },
    });
    if (!own || own.ownerUserId !== userId) {
      return { success: false, message: 'Bu bina icin yetkiniz yok' };
    }
    const streamId = this.streamIdFor(buildingId);

    if (!rtspUrl || !enabled) {
      // Kamera kapatiliyor / siliniyor
      await this.removeFromGo2rtc(streamId);
      await this.prisma.building.update({
        where: { id: buildingId },
        data: { cameraEnabled: false, cameraRtspUrl: rtspUrl, cameraStreamId: null },
      });
      return { success: true, enabled: false };
    }

    // go2rtc'ye ekle
    const added = await this.addToGo2rtc(streamId, rtspUrl);
    await this.prisma.building.update({
      where: { id: buildingId },
      data: {
        cameraRtspUrl: rtspUrl,
        cameraEnabled: true,
        cameraStreamId: streamId,
      },
    });
    return { success: true, enabled: true, streamId, go2rtcOk: added };
  }

  // Bir binanin kamera durumunu getir (mobil bununla WebRTC'ye baglanir)
  async getCamera(buildingId: string) {
    const b = await this.prisma.building.findUnique({
      where: { id: buildingId },
      select: { cameraEnabled: true, cameraStreamId: true },
    });
    if (!b || !b.cameraEnabled || !b.cameraStreamId) {
      return { hasCamera: false };
    }
    return { hasCamera: true, streamId: b.cameraStreamId };
  }
}
