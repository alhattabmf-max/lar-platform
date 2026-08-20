import { Controller, Get, Res } from "@nestjs/common";
import type { Response } from "express";
import { PrismaService } from "../database/prisma.service";
import { RedisService } from "../common/redis/redis.service";
import { StorageService } from "../storage/storage.service";

interface DependencyCheck {
  status: "ok" | "error";
  blocking: boolean;
  error?: string;
}

@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly storage: StorageService
  ) {}

  /**
   * Liveness only: confirms the process itself is up and able to
   * respond. No dependency is checked here on purpose — a database
   * blip should never cause an orchestrator to kill and restart a
   * perfectly healthy process.
   */
  @Get("health")
  health(): { status: "ok"; timestamp: string } {
    return { status: "ok", timestamp: new Date().toISOString() };
  }

  /**
   * Readiness: PostgreSQL is the only blocking dependency in Phase 1,
   * because it is the only one apps/api actually relies on in a real
   * request path right now. Redis and MinIO are reported for
   * visibility but do NOT flip overall readiness to false — this is a
   * Phase 1-specific fact, not a permanent rule; it is expected to
   * change as later phases add request paths that genuinely depend on
   * them (e.g. queue-backed checkout).
   */
  @Get("ready")
  async ready(@Res() res: Response): Promise<void> {
    const [postgres, redis, storage] = await Promise.all([
      this.prisma.ping(),
      this.redis.ping(),
      this.storage.ping(),
    ]);

    const checks: Record<string, DependencyCheck> = {
      postgres: { status: postgres.ok ? "ok" : "error", blocking: true, error: postgres.error },
      redis: { status: redis.ok ? "ok" : "error", blocking: false, error: redis.error },
      storage: { status: storage.ok ? "ok" : "error", blocking: false, error: storage.error },
    };

    const isReady = postgres.ok;

    res.status(isReady ? 200 : 503).json({
      status: isReady ? "ok" : "not_ready",
      timestamp: new Date().toISOString(),
      checks,
    });
  }
}
