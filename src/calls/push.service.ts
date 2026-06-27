import { Injectable, Logger } from '@nestjs/common';
import * as admin from 'firebase-admin';
import { PrismaService } from '../prisma/prisma.service';
@Injectable()
export class PushService {
  private logger = new Logger('PushService');
  private initialized = false;
  constructor(private prisma: PrismaService) {
    this.initFirebase();
  }
  private initFirebase() {
    try {
      if (admin.apps.length === 0) {
        const serviceAccount = require('/app/firebase-admin.json');
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
        });
      }
      this.initialized = true;
      this.logger.log('Firebase Admin baslatildi');
    } catch (e) {
      this.logger.error('Firebase Admin baslatilamadi: ' + e.message);
    }
  }
  // Gelen çağrı bildirimi - DATA mesajı (arka planda CallKit tetikler)
  async sendIncomingCall(receiverUserId: string, callerName: string, callId: string, callerUserId: string, callerPhotoUrl?: string, buildingId?: string) {
    if (!this.initialized) return;
    const user = await this.prisma.user.findUnique({
      where: { id: receiverUserId },
      select: { fcmToken: true },
    });
    if (!user?.fcmToken) {
      this.logger.warn(`Kullanicinin FCM token yok: ${receiverUserId}`);
      return;
    }
    try {
      await admin.messaging().send({
        token: user.fcmToken,
        data: {
          type: 'incoming_call',
          callId: callId,
          callerName: callerName,
          callerUserId: callerUserId,
          callerPhoto: callerPhotoUrl || '',
          buildingId: buildingId || '',
        },
        android: {
          priority: 'high',
          ttl: 60000,
        },
      });
      this.logger.log(`Push (data) gonderildi: ${receiverUserId}`);
    } catch (e) {
      this.logger.error('Push gonderilemedi: ' + e.message);
    }
  }
  // Not bildirimi - GORUNUR notification (kargonuz geldi vb.)
  async sendNoteNotification(receiverUserIds: string[], title: string, body: string) {
    if (!this.initialized) return;
    const users = await this.prisma.user.findMany({
      where: { id: { in: receiverUserIds }, fcmToken: { not: null } },
      select: { fcmToken: true },
    });
    for (const u of users) {
      if (!u.fcmToken) continue;
      try {
        await admin.messaging().send({
          token: u.fcmToken,
          notification: { title, body },
          data: { type: 'note' },
          android: { priority: 'high', notification: { sound: 'default' } },
        });
      } catch (e) {
        this.logger.error('Not push gonderilemedi: ' + e.message);
      }
    }
    this.logger.log(`Not push gonderildi: ${users.length} kullanici`);
  }
  // Cagri iptal - CallKit kapatma push'u (data-only)
  async sendCallCancelled(receiverUserId: string, callId: string) {
    if (!this.initialized) return;
    const user = await this.prisma.user.findUnique({ where: { id: receiverUserId }, select: { fcmToken: true } });
    if (!user?.fcmToken) return;
    try {
      await admin.messaging().send({
        token: user.fcmToken,
        data: { type: 'call_cancelled', callId: callId },
        android: { priority: 'high' },
      });
      this.logger.log(`Iptal push gonderildi: ${receiverUserId}`);
    } catch (e) {
      this.logger.error('Iptal push gonderilemedi: ' + e.message);
    }
  }
}
