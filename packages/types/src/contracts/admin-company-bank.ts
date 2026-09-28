/**
 * A supplier's bank account, as the console reads it.
 *
 * SEPARATE FROM THE ADMIN QUEUE SHAPE it replaces. That one listed
 * every account ever submitted, for a screen that decided them one
 * by one; this is the account itself, shown on the record where the
 * verification is decided.
 *
 * NO IBAN, NO CIPHERTEXT, NO FINGERPRINT — see the note on
 * `AdminCompanyDetail.bankAccounts`.
 */
export interface AdminCompanyBankAccount {
  id: string;
  accountHolderName: string;
  bankName: string;
  /** The last four characters of the IBAN. Never the number. */
  ibanLast4: string;
  verificationStatus: string;
  /** Why it was refused, when it was. */
  rejectionReason: string | null;
  verifiedAt: string | null;
  createdAt: string;
}

export const ADMIN_COMPANY_BANK_ACCOUNT_KEYS = [
  "id",
  "accountHolderName",
  "bankName",
  "ibanLast4",
  "verificationStatus",
  "rejectionReason",
  "verifiedAt",
  "createdAt",
] as const satisfies readonly (keyof AdminCompanyBankAccount)[];
