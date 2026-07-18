import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SuperadminController } from './superadmin.controller';
import { SuperadminService } from './superadmin.service';
import { PushService } from '../calls/push.service';
import { SiteTextsService } from '../site-texts/site-texts.service';
import { MailService } from '../mail/mail.service';
import { VehiclesModule } from '../vehicles/vehicles.module';
import { VehicleOrdersModule } from '../vehicle-orders/vehicle-orders.module';

@Module({
  imports: [PrismaModule, VehiclesModule, VehicleOrdersModule],
  controllers: [SuperadminController],
  providers: [SuperadminService, PushService, SiteTextsService, MailService],
})
export class SuperadminModule {}
