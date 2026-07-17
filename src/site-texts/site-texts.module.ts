import { Module } from '@nestjs/common';
import { SiteTextsController } from './site-texts.controller';
import { SiteTextsService } from './site-texts.service';

@Module({
  controllers: [SiteTextsController],
  providers: [SiteTextsService],
})
export class SiteTextsModule {}
