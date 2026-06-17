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

  // Gelen çağrı bildirimi gönder
  async sendIncomingCall(receiverUserId: string, callerName: string, callId: string) {
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
        notification: {
          title: 'Gelen Çağrı',
          body: `${callerName} sizi arıyor`,
        },
        data: {
          type: 'incoming_call',
          callId: callId,
          callerName: callerName,
        },
        android: {
          priority: 'high',
          notification: {
            channelId: 'calls',
            priority: 'high',
            sound: 'default',
          },
        },
      });
      this.logger.log(`Push gonderildi: ${receiverUserId}`);
    } catch (e) {
      this.logger.error('Push gonderilemedi: ' + e.message);
    }
  }
}
