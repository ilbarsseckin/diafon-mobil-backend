import { Injectable } from '@nestjs/common';
import Redis from 'ioredis';

/**
 * Online kullanici ve socket eslesmesini Redis'te tutar.
 * userId <-> socketId map'i.
 */
@Injectable()
export class PresenceService {
  private redis: Redis;

  constructor() {
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'redis',
      port: parseInt(process.env.REDIS_PORT || '6379'),
    });
  }

  async setOnline(userId: string, socketId: string) {
    await this.redis.set(`socket:user:${userId}`, socketId);
    await this.redis.set(`socket:sock:${socketId}`, userId);
  }

  async getSocketId(userId: string): Promise<string | null> {
    return this.redis.get(`socket:user:${userId}`);
  }

  async getUserId(socketId: string): Promise<string | null> {
    return this.redis.get(`socket:sock:${socketId}`);
  }

  async setOffline(socketId: string) {
    const userId = await this.redis.get(`socket:sock:${socketId}`);
    if (userId) {
      await this.redis.del(`socket:user:${userId}`);
    }
    await this.redis.del(`socket:sock:${socketId}`);
    return userId;
  }

  async isOnline(userId: string): Promise<boolean> {
    return (await this.redis.exists(`socket:user:${userId}`)) === 1;
  }
}
