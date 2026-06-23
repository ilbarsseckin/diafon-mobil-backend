import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SubscriptionService } from './subscription.service';

@Controller('subscription')
export class SubscriptionController {
  constructor(private subService: SubscriptionService) {}

  // Yoneticinin abonelik durumu (kalan gun, fiyat, durum)
  @UseGuards(JwtAuthGuard)
  @Get('my')
  async my(@Req() req: any) {
    return this.subService.mySubscriptions(req.user.userId);
  }
}
