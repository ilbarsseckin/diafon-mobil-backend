import { IsString, IsNotEmpty, IsOptional, IsEmail, Length, Matches } from 'class-validator';

export class RegisterDto {
  @IsString()
  @IsNotEmpty({ message: 'İsim zorunlu' })
  name: string;

  @IsString()
  @Matches(/^0[0-9]{10}$/, { message: 'Telefon 0 ile başlamalı ve 11 haneli olmalı (örn: 05397348688)' })
  phone: string;

  @IsOptional()
  @IsEmail({}, { message: 'Geçerli bir e-posta girin' })
  email?: string;
}

export class VerifyOtpDto {
  @IsString()
  @Matches(/^0[0-9]{10}$/, { message: 'Geçersiz telefon' })
  phone: string;

  @IsString()
  @Length(6, 6, { message: 'Kod 6 haneli olmalı' })
  code: string;
}

export class LoginDto {
  @IsString()
  @Matches(/^0[0-9]{10}$/, { message: 'Geçersiz telefon' })
  phone: string;
}
