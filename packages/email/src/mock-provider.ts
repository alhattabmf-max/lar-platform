import {
  isSimulatedDelivery,
  type EmailProvider,
  type EmailProviderMode,
  type SendEmailCommand,
} from "./provider";

/**
 * The development and test provider. It delivers nothing.
 *
 * Its log record is a CLOSED object with exactly four keys:
 *
 *     template · recipientUserId · outboxEventId · providerMode
 *
 * The recipient address, subject, bodies and `params` are deliberately
 * absent. The pre-8D0 implementation printed
 * `to=… subject="…"`, which put an email address and a subject line
 * into ordinary application logs; that is the defect this class
 * replaces. The address is still ACCEPTED — a provider cannot implement
 * the interface without it — it is simply never recorded.
 *
 * The sink is injected rather than reaching for a logger, so a test can
 * assert exact key equality without capturing global output, and so
 * this package stays free of any logging dependency.
 */
export interface MockEmailLogRecord {
  template: string;
  recipientUserId: string;
  outboxEventId: string;
  providerMode: EmailProviderMode;
}

export type MockEmailLogSink = (record: MockEmailLogRecord) => void;

/**
 * Correlation identifiers for a mock log line.
 *
 * Passed alongside the command instead of being parsed out of it: the
 * command carries an address and rendered bodies, and a mock that
 * inspected those to build its log would be one refactor away from
 * printing them.
 */
export interface MockEmailContext {
  template: string;
  recipientUserId: string;
  outboxEventId: string;
}

const UNSET = "unknown";

export class MockEmailProvider implements EmailProvider {
  readonly mode: EmailProviderMode = "mock";

  private readonly sink: MockEmailLogSink;
  private context: MockEmailContext | null = null;

  constructor(sink: MockEmailLogSink = () => undefined) {
    this.sink = sink;
  }

  /**
   * Supplies the correlation identifiers for the next send.
   *
   * The relay calls this immediately before `sendEmail`. Direct
   * transactional sends do not, and their log record carries `unknown`
   * for all three — which is correct: a password-reset email has no
   * notification, no outbox row, and no template id in this registry.
   */
  withContext(context: MockEmailContext): this {
    this.context = context;
    return this;
  }

  async sendEmail(command: SendEmailCommand): Promise<void> {
    // Honoured before anything else: an already-aborted signal must not
    // produce a log line claiming a send occurred.
    if (command.signal?.aborted) {
      throw new DOMException("aborted", "AbortError");
    }

    const context = this.context;
    this.context = null;

    this.sink({
      template: context?.template ?? UNSET,
      recipientUserId: context?.recipientUserId ?? UNSET,
      outboxEventId: context?.outboxEventId ?? UNSET,
      providerMode: this.mode,
    });
  }

  /** Always true for this provider — nothing leaves the process. */
  get deliveryIsSimulated(): boolean {
    return isSimulatedDelivery(this.mode);
  }
}
