import { Controller, Get, Post, Body, UseGuards, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto, VerifyOtpDto, LoginDto } from './dto/auth.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import * as fs from 'fs';
import * as path from 'path';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService, private prisma: PrismaService) {}

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

  // Profil fotosu yukle
  @UseGuards(JwtAuthGuard)
  @Post('profile-photo')
  async profilePhoto(@Req() req: any, @Body() body: { photo: string }) {
    const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    const clean = body.photo.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(clean, 'base64');
    const filename = `profile_${req.user.userId}_${Date.now()}.jpg`;
    fs.writeFileSync(path.join(uploadsDir, filename), buffer);
    const url = `/uploads/${filename}`;
    await this.prisma.user.update({ where: { id: req.user.userId }, data: { photoUrl: url } });
    return { url };
  }

  // Profil guncelle (isim + email)
  @UseGuards(JwtAuthGuard)
  @Post('update-profile')
  async updateProfile(@Req() req: any, @Body() body: { name?: string; email?: string }) {
    const data: any = {};
    if (body.name && body.name.trim()) data.name = body.name.trim();
    if (body.email !== undefined) data.email = body.email.trim() || null;
    const user = await this.prisma.user.update({
      where: { id: req.user.userId },
      data,
      select: { id: true, name: true, phone: true, email: true, role: true },
    });
    return { success: true, user };
  }

  // Profilim (guncel bilgiler)
  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@Req() req: any) {
    const user = await this.prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { id: true, name: true, phone: true, email: true, role: true, photoUrl: true },
    });
    return user;
  }
}
