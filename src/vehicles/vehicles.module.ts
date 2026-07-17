import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { VehiclesController } from './vehicles.controller';
import { VehiclesService } from './vehicles.service';
import { VehicleLabelService } from './vehicle-label.service';
import { PushService } from '../calls/push.service';

@Module({
  imports: [PrismaModule],
  controllers: [VehiclesController],
  providers: [VehiclesService, PushService, VehicleLabelService],
  exports: [VehiclesService, VehicleLabelService],
})
export class VehiclesModule {}
