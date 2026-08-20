import type { PrismaClient } from "@prisma/client";
import type { Logger } from "pino";
import { runOpportunityLifecycleSweep, type SweepResult } from "@platform/opportunity-lifecycle";

/**
 * Runs one sweep pass and logs it safely: start/end time, per-status
 * row counts, and duration on success; duration and error message
 * (never a stack trace with query parameters, never any
 * opportunity/company-identifying data) on failure. Rethrows on
 * failure so BullMQ's own attempts/backoff handles the retry — this
 * function never swallows an error.
 */
export async function processSweepJob(prisma: PrismaClient, logger: Logger): Promise<SweepResult> {
  const startedAt = Date.now();
  logger.info({ event: "opportunity_sweep_start", startedAt: new Date(startedAt).toISOString() }, "sweep starting");

  try {
    const result = await runOpportunityLifecycleSweep(prisma);
    const durationMs = Date.now() - startedAt;
    logger.info(
      {
        event: "opportunity_sweep_complete",
        durationMs,
        scheduledFinalized: result.scheduledFinalized,
        expiredFromActive: result.expiredFromActive,
        expiredFromPaused: result.expiredFromPaused,
        fundedSafetyNet: result.fundedSafetyNet,
      },
      "sweep completed"
    );
    return result;
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ event: "opportunity_sweep_failed", durationMs, error: message }, "sweep failed");
    throw err;
  }
}
