import { Controller, Get, UseGuards, Req } from '@nestjs/common';
import { CallsService } from './calls.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('calls')
export class CallsController {
  constructor(private callsService: CallsService) {}

  // Cagri gecmisim
  @UseGuards(JwtAuthGuard)
  @Get('history')
  history(@Req() req: any) {
    return this.callsService.history(req.user.userId);
  }
}
