import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateApartmentDto, AssignResidentDto } from './dto/apartment.dto';

@Injectable()
export class ApartmentsService {
  constructor(private prisma: PrismaService) {}

  async createApartment(dto: CreateApartmentDto) {
    const building = await this.prisma.building.findUnique({ where: { id: dto.buildingId } });
    if (!building) throw new NotFoundException('Bina bulunamadı');
    return this.prisma.apartment.create({
      data: { buildingId: dto.buildingId, flatNo: dto.flatNo, floor: dto.floor },
    });
  }

  async listByBuilding(buildingId: string) {
    return this.prisma.apartment.findMany({
      where: { buildingId },
      include: {
        residents: {
          include: { user: { select: { id: true, name: true, phone: true } } },
        },
      },
      orderBy: { flatNo: 'asc' },
    });
  }

  async assignResident(dto: AssignResidentDto) {
    const user = await this.prisma.user.findUnique({ where: { id: dto.userId } });
    if (!user) throw new NotFoundException('Kullanıcı bulunamadı');
    const apt = await this.prisma.apartment.findUnique({ where: { id: dto.apartmentId } });
    if (!apt) throw new NotFoundException('Daire bulunamadı');

    const existing = await this.prisma.resident.findUnique({
      where: { userId_apartmentId: { userId: dto.userId, apartmentId: dto.apartmentId } },
    });
    if (existing) throw new BadRequestException('Bu kullanıcı zaten bu daireye kayıtlı');

    // Kullaniciyi RESIDENT rolune yukselt (GUEST ise)
    if (user.role === 'GUEST') {
      await this.prisma.user.update({ where: { id: user.id }, data: { role: 'RESIDENT' } });
    }

    return this.prisma.resident.create({
      data: { userId: dto.userId, apartmentId: dto.apartmentId, visible: true },
    });
  }

  async setVisibility(residentId: string, visible: boolean) {
    const resident = await this.prisma.resident.findUnique({ where: { id: residentId } });
    if (!resident) throw new NotFoundException('Sakin kaydı bulunamadı');
    return this.prisma.resident.update({ where: { id: residentId }, data: { visible } });
  }

  async removeResident(residentId: string) {
    const resident = await this.prisma.resident.findUnique({ where: { id: residentId } });
    if (!resident) throw new NotFoundException('Sakin kaydı bulunamadı');
    await this.prisma.resident.delete({ where: { id: residentId } });
    return { message: 'Sakin kaydı silindi' };
  }
}
