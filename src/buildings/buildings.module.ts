import { Module } from '@nestjs/common';
import { BuildingsService } from './buildings.service';
import { BuildingsController } from './buildings.controller';
import { PushService } from '../calls/push.service';
@Module({
  controllers: [BuildingsController],
  providers: [BuildingsService, PushService],
})
export class BuildingsModule {}
