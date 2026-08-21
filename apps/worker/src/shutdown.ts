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
  /**
   * Runs FIRST, before any worker is closed.
   *
   * For the outbox relay this stops new claims: a pass that started
   * here would lease rows to a process about to exit, and those rows
   * would then sit unavailable until their lease lapsed. Stopping
   * intake before draining is what keeps that window empty.
   */
  onShutdownStart?: () => void;
  /**
   * How long to wait for in-flight work before aborting it.
   *
   * Omitted means wait indefinitely, which is the behaviour every
   * pre-8D0 caller had and still gets.
   */
  gracePeriodMs?: number;
  /**
   * Runs if the grace period expires with work still in flight.
   *
   * For the relay this aborts outstanding provider calls, so a provider
   * that never answers cannot hold the process open. The affected rows
   * stay PROCESSING and are recovered by lease expiry — a bounded
   * delay, never a lost event.
   */
  onGraceExpired?: () => void;
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
        // Intake stops before draining begins.
        deps.onShutdownStart?.();

        const closing = Promise.all(deps.workers.map((w) => w.close()));

        if (deps.gracePeriodMs !== undefined && deps.onGraceExpired) {
          let graceTimer: NodeJS.Timeout | undefined;
          const grace = new Promise<"expired">((resolve) => {
            graceTimer = setTimeout(() => resolve("expired"), deps.gracePeriodMs);
          });

          // Whichever comes first. If the grace period wins, in-flight
          // work is aborted and we KEEP awaiting the close — aborting is
          // how the close is unblocked, not a reason to skip it.
          const outcome = await Promise.race([closing.then(() => "closed" as const), grace]);
          if (graceTimer) clearTimeout(graceTimer);

          if (outcome === "expired") {
            deps.logger.warn(
              { signal, gracePeriodMs: deps.gracePeriodMs },
              "Grace period expired; aborting in-flight work"
            );
            deps.onGraceExpired();
            await closing;
          }
        } else {
          await closing;
        }

        await Promise.all(deps.queues.map((q) => q.close()));
        for (const c of deps.workerConnections) c.disconnect();
        for (const c of deps.queueConnections) c.disconnect();
        await deps.prisma.$disconnect();
        deps.logger.info("Worker shutdown complete");
      } catch (err) {
        // The error TYPE, never its message. A close failure here comes
        // from Prisma or ioredis, whose messages routinely embed the
        // connection string — password included — and, now that the
        // email relay closes through this same handler, potentially
        // provider text as well. The class name is enough to tell a
        // connection failure from a timeout; the rest belongs in a
        // debugger, not a log.
        deps.logger.error(
          { errorName: err instanceof Error ? err.name : typeof err },
          "Error during shutdown"
        );
      } finally {
        (deps.onExit ?? (() => process.exit(0)))();
      }
    })();

    return shutdownPromise;
  };
}
