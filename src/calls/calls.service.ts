import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class CallsService {
  constructor(private prisma: PrismaService) {}

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
        callerUser: { select: { id: true, name: true } },
        receiverUser: { select: { id: true, name: true } },
      },
    });
    return calls.map(c => {
      const isOutgoing = c.callerUserId === userId;
      const other = isOutgoing ? c.receiverUser : c.callerUser;
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

  async savePhoto(base64Data: string): Promise<string> {
    const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    const clean = base64Data.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(clean, 'base64');
    const filename = `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
    fs.writeFileSync(path.join(uploadsDir, filename), buffer);
    return `/uploads/${filename}`;
  }

  async cleanOldPhotos() {
    const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
    if (!fs.existsSync(uploadsDir)) return;
    const files = fs.readdirSync(uploadsDir);
    const now = Date.now();
    const maxAge = 30 * 24 * 60 * 60 * 1000;
    for (const file of files) {
      const filePath = path.join(uploadsDir, file);
      try {
        const stat = fs.statSync(filePath);
        if (now - stat.mtimeMs > maxAge) fs.unlinkSync(filePath);
      } catch (e) {}
    }
  }
}
