export interface SendEmailParams {
  to: string;
  subject: string;
  htmlBody: string;
  textBody?: string;
}

/**
 * Provider Adapter = an isolation layer that lets a real email vendor
 * be plugged in later without touching any calling code. Phase 1 only
 * ships MockEmailProvider (EMAIL_PROVIDER_MODE=mock); a real provider
 * is added behind this same interface in a later phase.
 */
export interface EmailProvider {
  sendEmail(params: SendEmailParams): Promise<void>;
}

export const EMAIL_PROVIDER = Symbol("EMAIL_PROVIDER");
