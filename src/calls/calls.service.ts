import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CallsService {
  constructor(private prisma: PrismaService) {}

  // Kullanicinin cagri gecmisi (yaptigi + aldigi)
  async history(userId: string) {
    const calls = await this.prisma.call.findMany({
      where: {
        OR: [
          { callerUserId: userId },
          { receiverUserId: userId },
        ],
      },
      orderBy: { startedAt: 'desc' },
      take: 50,
      include: {
        caller: { select: { id: true, name: true } },
        receiver: { select: { id: true, name: true } },
      },
    });

    return calls.map(c => {
      const isOutgoing = c.callerUserId === userId;
      const other = isOutgoing ? c.receiver : c.caller;
      return {
        id: c.id,
        direction: isOutgoing ? 'outgoing' : 'incoming',
        otherName: other?.name || 'Bilinmeyen',
        status: c.status,
        startedAt: c.startedAt,
        duration: c.duration,
      };
    });
  }
}
