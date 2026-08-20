import { Injectable } from "@nestjs/common";
import { RedisThrottlerStorage } from "./redis-throttler.storage";
import { BusinessException } from "../errors/business-exception";
import { ERROR_CODES } from "@platform/types";
import type { RateLimitConfig } from "../../settings/security-settings.service";

@Injectable()
export class DynamicRateLimiter {
  constructor(private readonly storage: RedisThrottlerStorage) {}

  async enforce(throttlerName: string, trackerKey: string, config: RateLimitConfig): Promise<void> {
    const record = await this.storage.increment(
      trackerKey,
      config.ttlSeconds * 1000,
      config.limit,
      config.ttlSeconds * 1000,
      throttlerName
    );

    if (record.isBlocked) {
      throw new BusinessException(
        429,
        ERROR_CODES.RATE_LIMITED,
        "Too many attempts — please wait before trying again"
      );
    }
  }
}
