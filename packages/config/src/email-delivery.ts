/**
 * The one place that decides whether a process may start against a
 * provider that does not deliver.
 *
 * It lives in `@platform/config` rather than in `@platform/email`
 * because it is a rule about ENVIRONMENT CONSISTENCY, not about
 * sending: it reads three variables and compares them. The email
 * package stays a sending layer with no opinion on deployment.
 *
 * It is invoked at process start by BOTH `apps/api` and `apps/worker`.
 * Putting it in the API's `configureApp` alone would leave the worker —
 * which never calls `configureApp` — starting happily against a mock
 * provider in production, and the worker is precisely the process that
 * runs the relay.
 */

export interface EmailDeliveryConfig {
  NODE_ENV: "development" | "test" | "production";
  EMAIL_REQUIRED: boolean;
  EMAIL_PROVIDER_MODE: "mock";
}

/**
 * Provider modes that deliver nothing.
 *
 * A set rather than an equality check, so adding a real provider mode
 * is a one-line change here and every caller keeps working.
 */
const SIMULATED_MODES: ReadonlySet<string> = new Set(["mock"]);

export function isSimulatedProviderMode(mode: string): boolean {
  return SIMULATED_MODES.has(mode);
}

/**
 * Throws when a production deployment claims to need email but is
 * configured with a provider that sends nothing.
 *
 * A **boot failure**, not a logged warning. A warning in a startup log
 * is read once, on the day it is added; the failure mode it guards
 * against — a production system silently dropping every notification
 * while reporting healthy — is exactly the kind that survives for
 * months behind a warning nobody greps for.
 *
 * The three conditions are independent on purpose:
 *
 *   NODE_ENV !== production   development and test are expected to run
 *                             on the mock; this rule says nothing about
 *                             them.
 *   EMAIL_REQUIRED === false  the deployment has declared that email is
 *                             not load-bearing for it. Allowed to boot,
 *                             and it is the default.
 *   mode not simulated        a real provider is configured; nothing to
 *                             object to.
 *
 * Note the current degenerate axis: `EMAIL_PROVIDER_MODE` accepts only
 * `"mock"`, so the third condition is always true today and the gate is
 * governed by the first two. That changes the moment a real mode is
 * added, and the check needs no edit when it does.
 */
export function assertEmailDeliveryConfigured(config: EmailDeliveryConfig): void {
  const inProduction = config.NODE_ENV === "production";
  const simulated = isSimulatedProviderMode(config.EMAIL_PROVIDER_MODE);

  if (inProduction && config.EMAIL_REQUIRED && simulated) {
    throw new Error(
      "Refusing to start: EMAIL_REQUIRED=true in production, but EMAIL_PROVIDER_MODE=" +
        `"${config.EMAIL_PROVIDER_MODE}" delivers no mail. ` +
        "Configure a real email provider, or set EMAIL_REQUIRED=false to acknowledge " +
        "that this deployment runs without email delivery."
    );
  }
}

/**
 * Whether messages this process reports as sent were actually
 * delivered.
 *
 * Carried into relay logs and, in 8F, into the outbox stats response as
 * `deliveryIsSimulated`. It exists because `PUBLISHED` on an outbox row
 * means "the configured provider accepted the command" — with the mock,
 * that acceptance is a log line and nothing left the process. A
 * dashboard counting `PUBLISHED` would otherwise show a perfectly
 * healthy relay delivering no mail at all.
 */
export function deliveryIsSimulated(config: Pick<EmailDeliveryConfig, "EMAIL_PROVIDER_MODE">): boolean {
  return isSimulatedProviderMode(config.EMAIL_PROVIDER_MODE);
}
