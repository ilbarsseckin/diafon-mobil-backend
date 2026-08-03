import { Module } from '@nestjs/common';
import { BuildingsService } from './buildings.service';
import { BuildingsController } from './buildings.controller';
import { PushService } from '../calls/push.service';
import { SmsService } from '../sms/sms.service';
import { TuyaAdapter } from '../door/adapters/tuya.adapter';
import { DoorModule } from '../door/door.module';

@Module({
  imports: [DoorModule],
  controllers: [BuildingsController],
  providers: [BuildingsService, PushService, SmsService, TuyaAdapter],
})
export class BuildingsModule {}
