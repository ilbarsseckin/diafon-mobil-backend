import { IsString, IsNotEmpty, IsOptional, IsNumber, Min, Max } from 'class-validator';

export class CreateBuildingDto {
  @IsString()
  @IsNotEmpty({ message: 'Bina adı zorunlu' })
  buildingName: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsNumber({}, { message: 'Latitude sayı olmalı' })
  @Min(-90) @Max(90)
  latitude: number;

  @IsNumber({}, { message: 'Longitude sayı olmalı' })
  @Min(-180) @Max(180)
  longitude: number;

  @IsOptional()
  @IsNumber()
  @Min(5) @Max(500)
  radiusMeter?: number;
}
