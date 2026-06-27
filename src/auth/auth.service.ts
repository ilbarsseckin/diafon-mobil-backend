import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from '../sms/sms.service';
import Redis from 'ioredis';
import { RegisterDto, VerifyOtpDto, LoginDto } from './dto/auth.dto';

@Injectable()
export class AuthService {
  private redis: Redis;
  private readonly DEV_OTP = '123456';
  private readonly OTP_TTL = 300; // 5 dakika

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private sms: SmsService,
  ) {
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'redis',
      port: parseInt(process.env.REDIS_PORT || '6379'),
    });
  }

  private otpKey(phone: string) {
    return `otp:${phone}`;
  }

  private async sendOtp(phone: string): Promise<void> {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    await this.redis.set(this.otpKey(phone), code, 'EX', this.OTP_TTL);
    // DEV_OTP (123456) her zaman geçerli — production'da SMS gider
    await this.sms.sendOtp(phone, code);
    if (true) {
      console.log(`[OTP] ${phone} -> SMS gonderildi`);
    } else {
      console.log(`[OTP] ${phone} -> ${code} (SMS gonderilemedi, gelistirme modu)`);
    }
  }

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({ where: { phone: dto.phone } });
    if (existing) {
      throw new BadRequestException('Bu telefon numarası zaten kayıtlı. Giriş yapın.');
    }
    await this.prisma.user.create({
      data: {
        name: dto.name,
        phone: dto.phone,
        email: dto.email,
        role: 'GUEST',
        phoneVerified: false,
      },
    });
    await this.sendOtp(dto.phone);
    return { message: 'Doğrulama kodu gönderildi.', phone: dto.phone };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { phone: dto.phone } });
    if (!user) {
      throw new NotFoundException('Bu numara kayıtlı değil. Önce üye olun.');
    }
    if (user.blocked) {
      throw new BadRequestException('Hesabınız engellenmiş.');
    }
    await this.sendOtp(dto.phone);
    return { message: 'Doğrulama kodu gönderildi.', phone: dto.phone };
  }

  async verify(dto: VerifyOtpDto) {
    const saved = await this.redis.get(this.otpKey(dto.phone));
    if (!saved) {
      throw new BadRequestException('Kodun süresi dolmuş. Tekrar isteyin.');
    }
    // 123456 her zaman geçerli (geliştirme/destek modu)
    if (saved !== dto.code && dto.code !== this.DEV_OTP) {
      throw new BadRequestException('Kod hatalı.');
    }
    await this.redis.del(this.otpKey(dto.phone));
    const user = await this.prisma.user.update({
      where: { phone: dto.phone },
      data: { phoneVerified: true },
    });
    const token = this.jwt.sign({ sub: user.id, phone: user.phone, role: user.role });
    return {
      token,
      user: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        role: user.role,
        phoneVerified: user.phoneVerified,
      },
    };
  }

  async saveFcmToken(userId: string, fcmToken: string) {
    console.log('SAVE FCM TOKEN cagrildi: userId=' + userId + ' tokenLen=' + (fcmToken ? fcmToken.length : 'NULL'));
    const r = await this.prisma.user.update({
      where: { id: userId },
      data: { fcmToken },
    });
    console.log('SAVE FCM TOKEN basarili: ' + r.name);
    return { message: 'Token kaydedildi' };
  }
}
