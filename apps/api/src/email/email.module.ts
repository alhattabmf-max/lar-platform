import { Logger, Module } from "@nestjs/common";
import { MockEmailProvider, type EmailProvider } from "@platform/email";
import { EMAIL_PROVIDER } from "./email-provider.interface";

/**
 * Binds the SHARED provider to Nest's container.
 *
 * A thin adapter by design: the provider implementation lives in
 * `@platform/email` so the worker can use the identical one, and this
 * module only supplies the DI wiring and a logger sink.
 *
 * The sink receives a closed four-key record — `template`,
 * `recipientUserId`, `outboxEventId`, `providerMode` — and is passed
 * through verbatim. Nothing here reads the address, the subject or the
 * bodies, and nothing here may start: the record is the entire
 * permitted log surface for a send.
 */
const emailLogger = new Logger("EmailProvider");

export function createEmailProvider(): EmailProvider {
  return new MockEmailProvider((record) => {
    // `providerMode` travels with every line so a reader never has to
    // infer whether anything was actually delivered. With "mock",
    // nothing was.
    emailLogger.log(record);
  });
}

@Module({
  providers: [{ provide: EMAIL_PROVIDER, useFactory: createEmailProvider }],
  exports: [EMAIL_PROVIDER],
})
export class EmailModule {}
