import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { HealthController } from './health/health.controller';
import { AuthModule } from './auth/auth.module';
import { BuildingsModule } from './buildings/buildings.module';
import { ApartmentsModule } from './apartments/apartments.module';
import { CallsModule } from './calls/calls.module';
import { DoorModule } from './door/door.module';
import { SubscriptionModule } from './subscription/subscription.module';
import { SuperadminModule } from './superadmin/superadmin.module';
import { PlansModule } from './plans/plans.module';
import { MailModule } from './mail/mail.module';
import { SmsModule } from './sms/sms.module';
import { PaymentModule } from './payment/payment.module';
import { AccountCleanupService } from './tasks/account-cleanup.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    BuildingsModule,
    ApartmentsModule,
    CallsModule,
    DoorModule,
    SubscriptionModule,
    SuperadminModule,
    PaymentModule,
    SmsModule,
    MailModule,
    PlansModule,
  ],
  controllers: [HealthController],
  providers: [AccountCleanupService],
})
export class AppModule {}
