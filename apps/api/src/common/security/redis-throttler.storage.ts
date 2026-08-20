import { Injectable } from "@nestjs/common";
import type { ThrottlerStorage } from "@nestjs/throttler";
import type { ThrottlerStorageRecord } from "@nestjs/throttler/dist/throttler-storage-record.interface";
import { RedisService } from "../redis/redis.service";

const KEY_PREFIX = "throttle:";

/**
 * Centralized, configurable rate limiting (Blueprint requirement: no
 * ad hoc counters scattered inside controllers). Backed by the same
 * Redis instance as sessions — limits therefore hold correctly across
 * multiple API process instances, not just per-process memory.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly redis: RedisService) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string
  ): Promise<ThrottlerStorageRecord> {
    const client = this.redis.getClient();
    const hitKey = `${KEY_PREFIX}${throttlerName}:${key}`;
    const blockKey = `${KEY_PREFIX}${throttlerName}:${key}:blocked`;

    const blockedTtlMs = await client.pttl(blockKey);
    if (blockedTtlMs > 0) {
      const totalHits = Number((await client.get(hitKey)) ?? limit);
      return {
        totalHits,
        timeToExpire: Math.ceil((await client.pttl(hitKey)) / 1000),
        isBlocked: true,
        timeToBlockExpire: Math.ceil(blockedTtlMs / 1000),
      };
    }

    const totalHits = await client.incr(hitKey);
    if (totalHits === 1) {
      await client.pexpire(hitKey, ttl);
    }

    const isBlocked = totalHits > limit;
    if (isBlocked && blockDuration > 0) {
      await client.set(blockKey, "1", "PX", blockDuration);
    }

    const remainingTtlMs = await client.pttl(hitKey);

    return {
      totalHits,
      timeToExpire: Math.ceil(Math.max(remainingTtlMs, 0) / 1000),
      isBlocked,
      timeToBlockExpire: isBlocked ? Math.ceil(blockDuration / 1000) : 0,
    };
  }
}
