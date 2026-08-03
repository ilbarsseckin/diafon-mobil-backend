import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { CallService } from './call.service';

// Netgsm Custom API webhook'u. Kimlik dogrulama JWT ile DEGIL,
// Netgsm fonksiyonunda tanimlanan sabit token ile yapilir (public endpoint).
@Controller('call')
export class CallController {
  constructor(private readonly service: CallService) {}

  @Post('netgsm')
  @HttpCode(200)
  async netgsm(@Body() body: any) {
    return this.service.route(body);
  }
}
