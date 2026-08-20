export interface VerificationSubject {
  companyId: string;
  crNumber: string;
  legalName: string;
}

export interface VerificationResult {
  approved: boolean;
  reason?: string;
}

/**
 * AUTOMATIC verification mode calls this interface — it never assumes
 * approval as a hardcoded rule. Phase 2 binds MockVerificationProvider;
 * a real CR-verification provider replaces it later behind this same
 * contract, with no change to VerificationService or callers.
 */
export interface VerificationProvider {
  verify(subject: VerificationSubject): Promise<VerificationResult>;
}

export const VERIFICATION_PROVIDER = Symbol("VERIFICATION_PROVIDER");
