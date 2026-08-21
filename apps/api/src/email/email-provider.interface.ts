import type { EmailProvider, SendEmailCommand, SendEmailParams } from "@platform/email";

/**
 * The API's DI token for the shared provider.
 *
 * The interface itself now lives in `@platform/email`, which is
 * framework-free: `apps/worker` runs the relay, has no NestJS, and has
 * no dependency path into `apps/api`. Keeping one implementation of the
 * sending behaviour means the two processes cannot drift.
 *
 * This file is the Nest-facing adapter surface and nothing more. It is
 * re-exported at the original import path so the auth flows written
 * before 8D0 keep working unchanged.
 */
export const EMAIL_PROVIDER = Symbol("EMAIL_PROVIDER");

export type { EmailProvider, SendEmailCommand, SendEmailParams };
