import { IsString, IsNotEmpty, IsOptional, IsInt, Min, Max, MaxLength, IsEmail } from 'class-validator';

export class ActivateVehicleDto {
  @IsString()
  @IsNotEmpty({ message: 'code zorunlu' })
  code: string;

  @IsEmail({}, { message: 'Gecerli bir e-posta adresi girin' })
  @IsNotEmpty({ message: 'email zorunlu' })
  @MaxLength(120)
  email: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  label?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  plate?: string;
}

export class GenerateBatchDto {
  @IsInt()
  @Min(1)
  @Max(1000)
  count: number;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  batch?: string;
}
