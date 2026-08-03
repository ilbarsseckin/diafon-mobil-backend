import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { DoorController } from './door.controller';
import { DoorService } from './door.service';
import { CameraService } from './camera.service';
import { SubscriptionModule } from '../subscription/subscription.module';
import { TuyaAdapter } from './adapters/tuya.adapter';
import { ShellyMqttAdapter } from './adapters/shelly-mqtt.adapter';

@Module({
  imports: [PrismaModule, SubscriptionModule],
  controllers: [DoorController],
  providers: [DoorService, TuyaAdapter, ShellyMqttAdapter, CameraService],
  exports: [DoorService, CameraService],
})
export class DoorModule {}
