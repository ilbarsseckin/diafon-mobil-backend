import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionService } from './subscription.service';
import { SubscriptionGateService } from './subscription-gate.service';

@Module({
  imports: [PrismaModule],
  controllers: [SubscriptionController],
  providers: [SubscriptionService, SubscriptionGateService],
  exports: [SubscriptionService, SubscriptionGateService],
})
export class SubscriptionModule {}
