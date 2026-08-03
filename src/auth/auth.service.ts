import { randomInt } from 'crypto';
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

  private attemptKey(phone: string) {
    return `otp:try:${phone}`;
  }

  private async sendOtp(phone: string): Promise<void> {
    // Ard arda istek sinirlamasi: 60 sn icinde tekrar kod istenemez.
    // Hem SMS kontoru korur hem spam engeller.
    const cooldown = await this.redis.get(`otp:cd:${phone}`);
    if (cooldown) {
      throw new BadRequestException('Cok sik kod istediniz. 1 dakika sonra tekrar deneyin.');
    }
    // Saatte en fazla 5 kod
    const saatlik = await this.redis.incr(`otp:hr:${phone}`);
    if (saatlik === 1) await this.redis.expire(`otp:hr:${phone}`, 3600);
    if (saatlik > 5) {
      throw new BadRequestException('Cok fazla kod istegi. Lutfen daha sonra deneyin.');
    }

    // Kriptografik olarak guvenli kod (Math.random tahmin edilebilir)
    const code = randomInt(100000, 1000000).toString();
    await this.redis.set(this.otpKey(phone), code, 'EX', this.OTP_TTL);
    await this.redis.del(this.attemptKey(phone));
    await this.redis.set(`otp:cd:${phone}`, '1', 'EX', 60);
    await this.sms.sendOtp(phone, code);
    console.log(`[OTP] ${phone} -> gonderildi`);
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

    // Brute-force korumasi: 5 yanlis denemeden sonra kod yanar.
    // Olmazsa 6 haneli kod otomatik betikle kirilabilir.
    const deneme = await this.redis.incr(this.attemptKey(dto.phone));
    if (deneme === 1) await this.redis.expire(this.attemptKey(dto.phone), this.OTP_TTL);
    if (deneme > 5) {
      await this.redis.del(this.otpKey(dto.phone));
      await this.redis.del(this.attemptKey(dto.phone));
      throw new BadRequestException('Cok fazla hatali deneme. Yeni kod isteyin.');
    }

    // Sabit kod SADECE acikca izin verilirse gecerli (magaza inceleme hesabi icin).
    // ALLOW_DEV_OTP env'de yoksa kapali kabul edilir. Canlida ASLA acmayin.
    const devIzin =
      process.env.ALLOW_DEV_OTP === 'true' &&
      !!process.env.DEV_OTP_PHONE &&
      dto.phone === process.env.DEV_OTP_PHONE;

    if (saved !== dto.code && !(devIzin && dto.code === this.DEV_OTP)) {
      throw new BadRequestException('Kod hatalı.');
    }

    await this.redis.del(this.otpKey(dto.phone));
    await this.redis.del(this.attemptKey(dto.phone));
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
