import type { PrismaClient } from "@prisma/client";
import type { Logger } from "pino";
import {
  DEFAULT_EMAIL_LOCALE,
  DISPATCH_CONCURRENCY,
  PROVIDER_TIMEOUT_MS,
  buildProviderDeliveryKey,
  classifyEmailFailure,
  hasAttemptsRemaining,
  isRetryable,
  isEmailTemplateId,
  nextAttemptAt,
  renderEmail,
  validateEmailNotificationV1,
  type EmailErrorClass,
  type EmailParams,
  type EmailProvider,
  type RandomSource,
} from "@platform/email";
import {
  databaseNow,
  runClaimPass,
  settleFailed,
  settlePublished,
  settleRetry,
  type ClaimedOutboxRow,
} from "./claim";
import { runBounded } from "./bounded-pool";

/**
 * One relay pass: claim a batch, dispatch it through a bounded pool,
 * settle each row.
 *
 * STRUCTURAL CONTRACT — the relay reads and writes `outbox_events` and
 * READS `users` for the recipient. Nothing else. It never touches
 * `notifications` (they do not exist yet and it must never depend on
 * them) and it writes no `AuditLog`: there is no business actor here,
 * and infrastructure events do not belong in an audit trail.
 *
 * DELIVERY SEMANTICS — at-least-once delivery with a stable provider
 * idempotency key. If the process dies after the provider accepted but
 * before settlement commits, the row is re-claimed once its lease
 * lapses and re-sent with the SAME `outbox:${id}` key, which a provider
 * honouring idempotency keys will collapse. A provider that does not
 * will deliver a duplicate.
 */

export interface RelayPassOptions {
  lockedBy: string;
  batchSize?: number;
  leaseSeconds?: number;
  providerTimeoutMs?: number;
  concurrency?: number;
  random?: RandomSource;
  /** Aborts in-flight sends on shutdown. */
  signal?: AbortSignal;
}

export interface RelayPassResult {
  terminalised: number;
  claimed: number;
  published: number;
  retried: number;
  failed: number;
  /** Settlements that matched zero rows because the claim was superseded. */
  superseded: number;
}

/** What the provider needs, resolved from `users` at send time. */
interface Recipient {
  email: string;
}

type Outcome =
  | { kind: "published" }
  | { kind: "retry"; errorClass: EmailErrorClass }
  | { kind: "failed"; errorClass: EmailErrorClass };

/**
 * Terminal without a provider call. Retrying cannot repair any of
 * these: a malformed payload stays malformed, an unknown template stays
 * unknown, and a missing or disabled user does not come back because we
 * waited.
 */
function terminal(errorClass: EmailErrorClass): Outcome {
  return { kind: "failed", errorClass };
}

/**
 * Resolves the recipient with the narrowest possible SELECT.
 *
 * Only three columns, and the address never leaves this function except
 * into the provider command. The outbox payload deliberately carries no
 * address at all — the relay resolves it here — so a deleted user
 * simply yields no address and the row dead-letters, which is what
 * makes the right to erasure work without a special case.
 */
async function resolveRecipient(
  prisma: PrismaClient,
  recipientUserId: string
): Promise<{ ok: true; recipient: Recipient } | { ok: false; errorClass: EmailErrorClass }> {
  const user = await prisma.user.findUnique({
    where: { id: recipientUserId },
    select: { email: true, status: true },
  });

  if (!user) return { ok: false, errorClass: "RECIPIENT_NOT_FOUND" };
  // The current model's only usable-account signal. Verification status
  // is deliberately NOT consulted: an unverified address is exactly
  // where a verification email has to go.
  if (user.status !== "ACTIVE") return { ok: false, errorClass: "RECIPIENT_INACTIVE" };
  if (user.email.length === 0) return { ok: false, errorClass: "RECIPIENT_NOT_FOUND" };

  return { ok: true, recipient: { email: user.email } };
}

/**
 * Calls the provider under a hard timeout that performs a REAL abort.
 *
 * The `AbortController` is the mechanism, not a race: the signal is
 * handed to the provider, which must honour it. A promise that merely
 * loses a race would leave the request running and the connection held
 * past the lease — the exact failure this guards against.
 *
 * The timer is always cleared in `finally`, so a fast success does not
 * leave a pending timer holding the event loop open.
 */
async function dispatchWithTimeout(
  provider: EmailProvider,
  command: Parameters<EmailProvider["sendEmail"]>[0],
  timeoutMs: number,
  externalSignal?: AbortSignal
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // Shutdown aborts in-flight sends too, so a grace period that expires
  // does not wait on a provider that may never answer.
  const onExternalAbort = (): void => controller.abort();
  externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
  if (externalSignal?.aborted) controller.abort();

  try {
    await provider.sendEmail({ ...command, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onExternalAbort);
  }
}

/**
 * Everything for one row up to (not including) settlement.
 *
 * Split out so the decision — publish, retry, or dead-letter — is a
 * pure consequence of the outcome, and so no branch can forget to
 * settle.
 */
async function dispatchRow(
  row: ClaimedOutboxRow,
  deps: { prisma: PrismaClient; provider: EmailProvider },
  options: { providerTimeoutMs: number; signal?: AbortSignal }
): Promise<Outcome> {
  const validated = validateEmailNotificationV1(row.payload);
  // Nothing about the payload is logged or stored — not the offending
  // key, not its value, not a validation message that would echo either.
  if (!validated.ok) return terminal("PAYLOAD_INVALID");

  const { template, recipientUserId, params } = validated.payload;
  if (!isEmailTemplateId(template)) return terminal("PAYLOAD_INVALID");

  const resolved = await resolveRecipient(deps.prisma, recipientUserId);
  if (!resolved.ok) return terminal(resolved.errorClass);

  let rendered;
  try {
    rendered = renderEmail(template, DEFAULT_EMAIL_LOCALE, params as EmailParams);
  } catch {
    return terminal("TEMPLATE_RENDER_FAILED");
  }

  try {
    await dispatchWithTimeout(
      deps.provider,
      {
        to: resolved.recipient.email,
        subject: rendered.subject,
        htmlBody: rendered.htmlBody,
        textBody: rendered.textBody,
        // Stable across every attempt at this row — the whole basis of
        // duplicate collapse after a crash.
        idempotencyKey: buildProviderDeliveryKey(row.id),
      },
      options.providerTimeoutMs,
      options.signal
    );
    return { kind: "published" };
  } catch (error) {
    // Classified from type and status code only. `error` is never read
    // for its message and never logged.
    const errorClass = classifyEmailFailure(error);
    return isRetryable(errorClass) ? { kind: "retry", errorClass } : { kind: "failed", errorClass };
  }
}

export interface RelayDeps {
  prisma: PrismaClient;
  provider: EmailProvider;
  logger: Logger;
}

export async function runOutboxRelayPass(
  deps: RelayDeps,
  options: RelayPassOptions
): Promise<RelayPassResult> {
  const providerTimeoutMs = options.providerTimeoutMs ?? PROVIDER_TIMEOUT_MS;
  const concurrency = options.concurrency ?? DISPATCH_CONCURRENCY;

  const { terminalised, claimed } = await runClaimPass(deps.prisma, {
    lockedBy: options.lockedBy,
    batchSize: options.batchSize,
    leaseSeconds: options.leaseSeconds,
  });

  const result: RelayPassResult = {
    terminalised: terminalised.length,
    claimed: claimed.length,
    published: 0,
    retried: 0,
    failed: 0,
    superseded: 0,
  };

  if (terminalised.length > 0) {
    deps.logger.warn(
      { event: "outbox_relay_terminalised", count: terminalised.length, errorClass: "ATTEMPTS_EXHAUSTED" },
      "retired outbox rows that had no attempts left"
    );
  }

  if (claimed.length === 0) return result;

  await runBounded(
    claimed,
    async (row) => {
      const startedAt = Date.now();
      const outcome = await dispatchRow(row, deps, { providerTimeoutMs, signal: options.signal });

      // Every settlement carries the SAME claim token this row was
      // leased with. A zero-row result means the lease lapsed and
      // another worker took over — this attempt is superseded, and it
      // must not retry, escalate, or touch the row's current state.
      let affected: number;
      if (outcome.kind === "published") {
        affected = await settlePublished(deps.prisma, row.id, row.claimToken);
        if (affected > 0) result.published++;
      } else if (outcome.kind === "retry" && hasAttemptsRemaining(row.attempts)) {
        const now = await databaseNow(deps.prisma);
        const when = nextAttemptAt({ attempts: row.attempts, now, random: options.random });
        affected = await settleRetry(deps.prisma, row.id, row.claimToken, when, outcome.errorClass);
        if (affected > 0) result.retried++;
      } else {
        // Either a terminal class, or a retryable one with the attempt
        // budget spent — the same dead-letter either way, keeping the
        // class that actually caused it rather than overwriting it with
        // ATTEMPTS_EXHAUSTED.
        affected = await settleFailed(deps.prisma, row.id, row.claimToken, outcome.errorClass);
        if (affected > 0) result.failed++;
      }

      if (affected === 0) {
        result.superseded++;
        deps.logger.warn(
          { event: "outbox_relay_settlement_superseded", outboxEventId: row.id, attempt: row.attempts },
          "settlement matched zero rows; this claim was superseded"
        );
        return;
      }

      // The allowlisted log surface. No address, no subject, no body, no
      // params, no payload, no exception message, no stack. "accepted"
      // rather than "delivered": with the mock provider nothing left the
      // process, and even a real provider only acknowledges receipt.
      deps.logger.info(
        {
          event: "outbox_relay_settled",
          outboxEventId: row.id,
          eventType: row.eventType,
          attempt: row.attempts,
          outcome: outcome.kind === "published" ? "provider_accepted" : outcome.kind,
          errorClass: outcome.kind === "published" ? null : outcome.errorClass,
          durationMs: Date.now() - startedAt,
          providerMode: deps.provider.mode,
          workerId: options.lockedBy,
        },
        "outbox row settled"
      );
    },
    { concurrency }
  );

  deps.logger.info(
    {
      event: "outbox_relay_pass",
      claimedCount: result.claimed,
      terminalisedCount: result.terminalised,
      published: result.published,
      retried: result.retried,
      failed: result.failed,
      superseded: result.superseded,
      providerMode: deps.provider.mode,
      workerId: options.lockedBy,
    },
    "outbox relay pass complete"
  );

  return result;
}
