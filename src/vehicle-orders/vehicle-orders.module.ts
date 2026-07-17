import { Module } from '@nestjs/common';
import { VehicleOrdersService } from './vehicle-orders.service';
import { VehicleOrdersController } from './vehicle-orders.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { VehiclesModule } from '../vehicles/vehicles.module';
import { MailModule } from '../mail/mail.module';
import { SmsModule } from '../sms/sms.module';

@Module({
  imports: [PrismaModule, VehiclesModule, MailModule, SmsModule],
  controllers: [VehicleOrdersController],
  providers: [VehicleOrdersService],
  exports: [VehicleOrdersService],
})
export class VehicleOrdersModule {}
