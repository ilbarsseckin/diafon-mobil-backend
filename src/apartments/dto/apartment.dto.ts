import { IsString, IsNotEmpty, IsOptional, IsUUID, IsBoolean } from 'class-validator';

export class CreateApartmentDto {
  @IsUUID('4', { message: 'Geçerli bina id gönderin' })
  buildingId: string;

  @IsString()
  @IsNotEmpty({ message: 'Daire no zorunlu' })
  flatNo: string;

  @IsOptional()
  @IsString()
  floor?: string;
}

export class AssignResidentDto {
  @IsUUID('4', { message: 'Geçerli kullanıcı id gönderin' })
  userId: string;

  @IsUUID('4', { message: 'Geçerli daire id gönderin' })
  apartmentId: string;
}

export class UpdateVisibilityDto {
  @IsBoolean()
  visible: boolean;
}
