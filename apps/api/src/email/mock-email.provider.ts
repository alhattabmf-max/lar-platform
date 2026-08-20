import { Injectable, Logger } from "@nestjs/common";
import type { EmailProvider, SendEmailParams } from "./email-provider.interface";

/**
 * Phase 1 default (EMAIL_PROVIDER_MODE=mock, per Blueprint §Provider
 * adapters). Logs the send attempt; sends nothing.
 */
@Injectable()
export class MockEmailProvider implements EmailProvider {
  private readonly logger = new Logger(MockEmailProvider.name);

  async sendEmail(params: SendEmailParams): Promise<void> {
    this.logger.log(`[mock] would send email to=${params.to} subject="${params.subject}"`);
  }
}
