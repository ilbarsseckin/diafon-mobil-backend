import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AccountCleanupService {
  private readonly logger = new Logger('AccountCleanup');
  constructor(private prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async cleanupDeletedAccounts() {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const toDelete = await this.prisma.user.findMany({
      where: { deletionRequestedAt: { not: null, lte: cutoff } },
      select: { id: true, name: true },
    });
    if (toDelete.length === 0) return;
    this.logger.log(`Silinecek hesap sayisi: ${toDelete.length}`);
    for (const u of toDelete) {
      try {
        await this.deleteUserCompletely(u.id);
        this.logger.log(`Hesap silindi: ${u.name} (${u.id})`);
      } catch (e: any) {
        this.logger.error(`Hesap silinemedi ${u.id}: ${e.message}`);
      }
    }
  }

  private async deleteUserCompletely(userId: string) {
    const buildings = await this.prisma.building.findMany({
      where: { ownerUserId: userId },
      select: { id: true },
    });
    for (const b of buildings) {
      await this.prisma.doorLog.deleteMany({ where: { buildingId: b.id } });
      await this.prisma.door.deleteMany({ where: { buildingId: b.id } });
      await this.prisma.call.deleteMany({ where: { buildingId: b.id } });
      await this.prisma.building.delete({ where: { id: b.id } });
    }
    await this.prisma.securityGuard.deleteMany({ where: { ownerUserId: userId } });
    await this.prisma.subscription.deleteMany({ where: { ownerUserId: userId } });
    await this.prisma.call.deleteMany({ where: { OR: [{ callerUserId: userId }, { receiverUserId: userId }] } });
    await this.prisma.doorLog.deleteMany({ where: { userId } });
    await this.prisma.user.delete({ where: { id: userId } });
  }
}
