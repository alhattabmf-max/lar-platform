import type { PrismaClient } from "@prisma/client";
import type { Logger } from "pino";
import { runCheckoutLockExpirySweep, type CheckoutLockExpirySweepResult } from "@platform/opportunity-lifecycle";

export async function processCheckoutLockExpiryJob(
  prisma: PrismaClient,
  logger: Logger
): Promise<CheckoutLockExpirySweepResult> {
  const startedAt = Date.now();
  logger.info(
    { event: "checkout_lock_expiry_sweep_start", startedAt: new Date(startedAt).toISOString() },
    "checkout lock expiry sweep starting"
  );

  try {
    const result = await runCheckoutLockExpirySweep(prisma);
    const durationMs = Date.now() - startedAt;
    logger.info(
      { event: "checkout_lock_expiry_sweep_complete", durationMs, locksExpired: result.locksExpired },
      "checkout lock expiry sweep completed"
    );
    return result;
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const message = err instanceof Error ? err.message : String(err);
    logger.error(
      { event: "checkout_lock_expiry_sweep_failed", durationMs, error: message },
      "checkout lock expiry sweep failed"
    );
    throw err;
  }
}
