import { Module } from "@nestjs/common";
import { ThrottlerModule } from "@nestjs/throttler";
import { RedisModule } from "../redis/redis.module";
import { RedisService } from "../redis/redis.service";
import { RedisThrottlerStorage } from "./redis-throttler.storage";

@Module({
  imports: [
    RedisModule,
    ThrottlerModule.forRootAsync({
      imports: [RedisModule],
      inject: [RedisService],
      useFactory: (redis: RedisService) => ({
        throttlers: [
          // Global default: generous, mainly a safety net. Sensitive
          // endpoints (login, forgot-password) override this via
          // @Throttle() at the controller — centralized through this
          // one module, never ad hoc counters in controllers.
          { name: "default", ttl: 60_000, limit: 100 },
        ],
        storage: new RedisThrottlerStorage(redis),
      }),
    }),
  ],
  exports: [ThrottlerModule],
})
export class RateLimitModule {}
