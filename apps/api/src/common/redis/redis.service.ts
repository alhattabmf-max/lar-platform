import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import Redis from "ioredis";
import type { Env } from "@platform/config";
import { APP_ENV } from "../../config/app-config.module";

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client!: Redis;

  constructor(@Inject(APP_ENV) private readonly env: Env) {}

  async onModuleInit(): Promise<void> {
    this.client = new Redis(this.env.REDIS_URL, { lazyConnect: true });
    await this.client.connect();
    this.logger.log("Connected to Redis");
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      this.client.disconnect();
    }
  }

  getClient(): Redis {
    return this.client;
  }

  /**
   * Informational health check only — Redis is NOT a blocking
   * dependency for `/ready` in Phase 1, because no request path in
   * apps/api actually depends on it yet. This will change in a later
   * Phase once a real path (e.g. queue-backed checkout) relies on
   * Redis being available.
   */
  async ping(): Promise<{ ok: boolean; error?: string }> {
    try {
      const result = await this.client.ping();
      return { ok: result === "PONG" };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "unknown error" };
    }
  }
}
