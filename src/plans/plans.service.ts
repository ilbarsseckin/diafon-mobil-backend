import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PlansService {
  constructor(private prisma: PrismaService) {}

  async getAll() {
    const plans = await this.prisma.plan.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
    return { plans };
  }

  async findByUnitCount(units: number) {
    return this.prisma.plan.findFirst({
      where: {
        isActive: true,
        minUnits: { lte: units },
        OR: [{ maxUnits: null }, { maxUnits: { gte: units } }],
      },
      orderBy: { sortOrder: 'asc' },
    });
  }
}
