import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SuperadminController } from './superadmin.controller';
import { SuperadminService } from './superadmin.service';
import { PushService } from '../calls/push.service';

@Module({
  imports: [PrismaModule],
  controllers: [SuperadminController],
  providers: [SuperadminService, PushService],
})
export class SuperadminModule {}
