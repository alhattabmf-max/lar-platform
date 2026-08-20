import type { PrismaClient } from "@prisma/client";
import type { Logger } from "pino";
import { runPaymentPendingExpirySweep, type PaymentPendingExpirySweepResult } from "@platform/opportunity-lifecycle";

export async function processPaymentPendingExpiryJob(
  prisma: PrismaClient,
  logger: Logger
): Promise<PaymentPendingExpirySweepResult> {
  const startedAt = Date.now();
  logger.info(
    { event: "payment_pending_expiry_sweep_start", startedAt: new Date(startedAt).toISOString() },
    "payment pending expiry sweep starting"
  );

  try {
    const result = await runPaymentPendingExpirySweep(prisma);
    const durationMs = Date.now() - startedAt;
    logger.info(
      { event: "payment_pending_expiry_sweep_complete", durationMs, attemptsExpired: result.attemptsExpired },
      "payment pending expiry sweep completed"
    );
    return result;
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const message = err instanceof Error ? err.message : String(err);
    logger.error(
      { event: "payment_pending_expiry_sweep_failed", durationMs, error: message },
      "payment pending expiry sweep failed"
    );
    throw err;
  }
}
