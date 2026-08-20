import { Injectable } from "@nestjs/common";
import type { EmailProvider, SendEmailParams } from "../../src/email/email-provider.interface";
import { pushCapturedEmail } from "./captured-emails";

@Injectable()
export class CapturingEmailProvider implements EmailProvider {
  async sendEmail(params: SendEmailParams): Promise<void> {
    pushCapturedEmail(params);
  }
}
