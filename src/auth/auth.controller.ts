import { Controller, Post, Body, UseGuards, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto, VerifyOtpDto, LoginDto } from './dto/auth.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('verify')
  verify(@Body() dto: VerifyOtpDto) {
    return this.authService.verify(dto);
  }

  // FCM push token kaydet (giriş yapmış kullanıcı)
  @UseGuards(JwtAuthGuard)
  @Post('fcm-token')
  saveFcmToken(@Req() req: any, @Body() body: { fcmToken: string }) {
    return this.authService.saveFcmToken(req.user.userId, body.fcmToken);
  }
}
