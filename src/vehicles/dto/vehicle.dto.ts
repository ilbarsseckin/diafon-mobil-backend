import { IsString, IsNotEmpty, IsOptional, IsInt, Min, Max, MaxLength } from 'class-validator';

export class ActivateVehicleDto {
  @IsString()
  @IsNotEmpty({ message: 'code zorunlu' })
  code: string;

  @IsString()
  @IsNotEmpty({ message: 'secretCode zorunlu' })
  secretCode: string;

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
  @Max(500)
  count: number;
}
