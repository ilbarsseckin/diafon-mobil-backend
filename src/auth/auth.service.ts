import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import Redis from 'ioredis';
import { RegisterDto, VerifyOtpDto, LoginDto } from './dto/auth.dto';

@Injectable()
export class AuthService {
  private redis: Redis;
  // Gelistirme modu: sabit OTP. Canliya cikinca SMS entegrasyonu eklenecek.
  private readonly DEV_OTP = '123456';
  private readonly OTP_TTL = 300; // 5 dakika

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'redis',
      port: parseInt(process.env.REDIS_PORT || '6379'),
    });
  }

  private otpKey(phone: string) {
    return `otp:${phone}`;
  }

  /** OTP uret ve "gonder" (gelistirmede sabit kod) */
  private async sendOtp(phone: string): Promise<void> {
    const code = this.DEV_OTP; // canlida: Math.floor(100000 + Math.random()*900000).toString()
    await this.redis.set(this.otpKey(phone), code, 'EX', this.OTP_TTL);
    // TODO: canlida NetGSM ile SMS gonder
    console.log(`[OTP] ${phone} -> ${code} (gelistirme modu)`);
  }

  /** Yeni kullanici kaydi + OTP gonder */
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

  /** Mevcut kullaniciya giris icin OTP gonder */
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

  /** OTP dogrula, JWT dondur */
  async verify(dto: VerifyOtpDto) {
    const saved = await this.redis.get(this.otpKey(dto.phone));
    if (!saved) {
      throw new BadRequestException('Kodun süresi dolmuş. Tekrar isteyin.');
    }
    if (saved !== dto.code) {
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
}
