import Redis from "ioredis";
import type { Env } from "@platform/config";

/**
 * BullMQ requires maxRetriesPerRequest: null on any connection it
 * manages — its blocking commands (BRPOPLPUSH etc.) would otherwise
 * be aborted by ioredis's own retry logic. This is the one deviation
 * from ioredis defaults; everything else (host/port/auth) comes
 * exclusively from env.REDIS_URL, itself validated by
 * @platform/config — never a hardcoded connection value here.
 */
export function createBullMqRedisConnection(env: Env): Redis {
  return new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    lazyConnect: true,
  });
}
