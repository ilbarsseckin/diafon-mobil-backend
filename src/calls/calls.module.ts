import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { CallsGateway } from './calls.gateway';
import { PresenceService } from './presence.service';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'dev-secret',
    }),
  ],
  providers: [CallsGateway, PresenceService],
})
export class CallsModule {}
