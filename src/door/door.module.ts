import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { DoorController } from './door.controller';
import { DoorService } from './door.service';
import { TuyaAdapter } from './adapters/tuya.adapter';

@Module({
  imports: [PrismaModule],
  controllers: [DoorController],
  providers: [DoorService, TuyaAdapter],
  exports: [DoorService],
})
export class DoorModule {}
