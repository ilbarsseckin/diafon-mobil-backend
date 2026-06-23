import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { HealthController } from './health/health.controller';
import { AuthModule } from './auth/auth.module';
import { BuildingsModule } from './buildings/buildings.module';
import { ApartmentsModule } from './apartments/apartments.module';
import { CallsModule } from './calls/calls.module';
import { DoorModule } from './door/door.module';
import { SubscriptionModule } from './subscription/subscription.module';
import { SuperadminModule } from './superadmin/superadmin.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    BuildingsModule,
    ApartmentsModule,
    CallsModule,
    DoorModule,
    SubscriptionModule,
    SuperadminModule,
  ],
  controllers: [HealthController],
  providers: [],
})
export class AppModule {}
