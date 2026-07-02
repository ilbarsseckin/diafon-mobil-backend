import { Controller, Get, Post, Body, UseGuards, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto, VerifyOtpDto, LoginDto } from './dto/auth.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import * as fs from 'fs';
import * as path from 'path';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService, private prisma: PrismaService, private jwtService: JwtService) {}

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

  // Misafir (ziyaretci) token - uygulamasiz arama icin
  @Post('guest-token')
  async guestToken(@Body() body: { qrToken: string }) {
    if (!body.qrToken) {
      return { success: false, message: 'QR token gerekli' };
    }
    const building = await this.prisma.building.findUnique({
      where: { qrToken: body.qrToken },
    });
    if (!building) {
      return { success: false, message: 'Bina bulunamadi' };
    }
    // Misafir icin gecici kimlik (DB'de kullanici degil, sadece token)
    const guestId = 'guest_' + Math.random().toString(36).substring(2, 12);
    const token = this.jwtService.sign(
      { sub: guestId, role: 'GUEST', guest: true, name: 'Ziyaretçi', buildingId: building.id },
      { secret: process.env.JWT_SECRET || 'dev-secret', expiresIn: '30m' },
    );
    return { success: true, token, guestId, buildingName: building.buildingName };
  }

  // --- Uyelik sil: sakin ise hemen, yonetici (bina sahibi) ise 30 gun sonra ---
  @UseGuards(JwtAuthGuard)
  @Post('delete-account')
  async deleteAccount(@Req() req: any) {
    const userId = req.user.userId;
    const ownedBuildings = await this.prisma.building.findMany({ where: { ownerUserId: userId }, select: { id: true } });
    if (ownedBuildings.length === 0) {
      // Sakin: hemen sil
      await this.prisma.call.deleteMany({ where: { OR: [{ callerUserId: userId }, { receiverUserId: userId }] } });
      await this.prisma.doorLog.deleteMany({ where: { userId } });
      await this.prisma.user.delete({ where: { id: userId } });
      return { success: true, immediate: true, message: 'Hesabiniz silindi' };
    }
    // Yonetici: 30 gun sonraya isaretle
    await this.prisma.user.update({
      where: { id: userId },
      data: { deletionRequestedAt: new Date() },
    });
    return { success: true, immediate: false, message: 'Hesabiniz 30 gun sonra silinecek. Bu sure icinde istediginiz zaman iptal edebilirsiniz.' };
  }

  // --- Uyelik silme talebini iptal et (30 gun dolmadan) ---
  @UseGuards(JwtAuthGuard)
  @Post('cancel-deletion')
  async cancelDeletion(@Req() req: any) {
    await this.prisma.user.update({
      where: { id: req.user.userId },
      data: { deletionRequestedAt: null },
    });
    return { success: true, message: 'Hesap silme talebi iptal edildi' };
  }

  // --- Silme durumu sorgula (mobilde gostermek icin) ---
  @UseGuards(JwtAuthGuard)
  @Get('deletion-status')
  async deletionStatus(@Req() req: any) {
    const user = await this.prisma.user.findUnique({ where: { id: req.user.userId }, select: { deletionRequestedAt: true } });
    if (!user?.deletionRequestedAt) return { pending: false };
    const daysLeft = 30 - Math.floor((Date.now() - user.deletionRequestedAt.getTime()) / (1000 * 60 * 60 * 24));
    return { pending: true, daysLeft: Math.max(0, daysLeft) };
  }
}
