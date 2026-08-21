import { Injectable } from "@nestjs/common";
import type { EmailProvider, EmailProviderMode, SendEmailCommand } from "@platform/email";
import { pushCapturedEmail } from "./captured-emails";

/**
 * Test double that keeps the rendered message so a spec can assert on
 * it. Unlike MockEmailProvider it deliberately DOES retain the address,
 * subject and bodies — a test needs to check what would have been sent;
 * a running system must not log it.
 */
@Injectable()
export class CapturingEmailProvider implements EmailProvider {
  readonly mode: EmailProviderMode = "mock";

  async sendEmail(command: SendEmailCommand): Promise<void> {
    pushCapturedEmail({
      to: command.to,
      subject: command.subject,
      htmlBody: command.htmlBody,
      textBody: command.textBody,
    });
  }
}
