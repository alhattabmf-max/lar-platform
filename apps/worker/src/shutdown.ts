import type { PrismaClient } from "@prisma/client";
import type { Queue, Worker } from "bullmq";
import type Redis from "ioredis";
import type { Logger } from "pino";

export interface ShutdownDeps {
  workers: Worker[];
  queues: Queue[];
  workerConnections: Redis[];
  queueConnections: Redis[];
  prisma: PrismaClient;
  logger: Logger;
  /** Called once shutdown finishes (success or error) — defaults to process.exit(0) in production; tests inject their own to avoid killing the test process. */
  onExit?: () => void;
}

export type ShutdownHandler = (signal: string) => Promise<void>;

/**
 * Idempotent by construction: a second (or Nth) call while a shutdown
 * is already in progress — or after one has already completed — waits
 * on the SAME in-flight promise instead of starting a new shutdown
 * sequence. worker.close() (called first, for every worker in
 * parallel) waits for any currently active job to finish before
 * resolving — this is BullMQ's own graceful-close behavior, not
 * something reimplemented here. Supports an arbitrary number of
 * worker/queue pairs so multiple independent BullMQ domains (the
 * opportunity sweep, the checkout lock expiry sweep) can share one
 * process-level shutdown sequence without merging their queues/jobs.
 */
export function createShutdownHandler(deps: ShutdownDeps): ShutdownHandler {
  let shutdownPromise: Promise<void> | null = null;

  return function shutdown(signal: string): Promise<void> {
    if (shutdownPromise) return shutdownPromise;

    shutdownPromise = (async () => {
      deps.logger.info({ signal }, "Worker shutting down");
      try {
        await Promise.all(deps.workers.map((w) => w.close()));
        await Promise.all(deps.queues.map((q) => q.close()));
        for (const c of deps.workerConnections) c.disconnect();
        for (const c of deps.queueConnections) c.disconnect();
        await deps.prisma.$disconnect();
        deps.logger.info("Worker shutdown complete");
      } catch (err) {
        deps.logger.error({ error: err instanceof Error ? err.message : String(err) }, "Error during shutdown");
      } finally {
        (deps.onExit ?? (() => process.exit(0)))();
      }
    })();

    return shutdownPromise;
  };
}
