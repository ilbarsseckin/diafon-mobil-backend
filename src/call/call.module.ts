import { Module } from '@nestjs/common';
import { CallController } from './call.controller';
import { CallService } from './call.service';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  controllers: [CallController],
  providers: [CallService, PrismaService],
})
export class CallModule {}
