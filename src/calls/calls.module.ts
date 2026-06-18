import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { CallsGateway } from './calls.gateway';
import { PresenceService } from './presence.service';
import { PushService } from './push.service';
import { CallsController } from './calls.controller';
import { CallsService } from './calls.service';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'dev-secret',
    }),
  ],
  controllers: [CallsController],
  providers: [CallsGateway, PresenceService, PushService, CallsService],
})
export class CallsModule {}
