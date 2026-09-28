/**
 * A SAUDI IBAN, AND THE BANK IT NAMES.
 *
 * WHY THIS IS SHARED. The same two questions are asked on both sides
 * of the wire and must be answered identically: "is this a real Saudi
 * IBAN" and "which bank is it". The server has to answer them because
 * it is what stores the payout account; the form has to answer them
 * because a supplier should see the bank appear as they type rather
 * than after a round trip. Two implementations of one rule drift, so
 * there is one, here, in the package both sides already import.
 *
 * THIS PACKAGE HAS NO DEPENDENCIES, deliberately, so everything below
 * is hand-rolled arithmetic and string work. It touches no crypto, no
 * network and no clock.
 *
 * WHAT VALIDITY MEANS HERE, and what it does not. A number that passes
 * `isValidSaudiIban` is well-FORMED: the right length, the right
 * country, and a check digit that agrees with the rest of the string.
 * That is a typo-catcher and nothing more. IT IS NOT PROOF THAT THE
 * ACCOUNT EXISTS, and it is NOT PROOF THAT THE COMPANY OWNS IT — those
 * are facts about the world that only a bank can confirm, and the
 * platform confirms them the way it confirms everything else about a
 * supplier: a human reviews the record before the company is approved.
 * Nothing here should ever be described to a user as verification.
 *
 * NO NETWORK CALL AND NO PAID LOOKUP. The bank is read out of the
 * number itself, because the number carries it.
 */

/** Uppercase, strip every space — the canonical form stored and compared. */
export function normalizeSaudiIban(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}

/**
 * "SA" + 2 check digits + 2-digit bank code + 18-digit account = 24.
 * The platform operates in Saudi Arabia, so this is the one national
 * format checked, rather than the far looser international pattern.
 */
export const SAUDI_IBAN_LENGTH = 24;

const SAUDI_IBAN_PATTERN = /^SA\d{22}$/;

/**
 * ISO 13616 / ISO 7064 MOD-97-10.
 *
 * The remainder is carried digit by digit rather than by converting
 * the rearranged string to a number: 24 characters is far past what a
 * JavaScript number holds exactly, and a silent precision loss here
 * would accept broken IBANs.
 */
export function isValidSaudiIban(normalized: string): boolean {
  if (!SAUDI_IBAN_PATTERN.test(normalized)) return false;

  const rearranged = normalized.slice(4) + normalized.slice(0, 4);
  let remainder = 0;
  for (const character of rearranged) {
    // "A" is 10 … "Z" is 35, per the standard. Only "S" and "A" can
    // reach this branch given the pattern above, but the general form
    // is kept so the function reads as the standard it implements.
    const numeric = /[A-Z]/.test(character)
      ? String(character.charCodeAt(0) - 55)
      : character;
    for (const digit of numeric) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder === 1;
}

/** The two digits at positions 5-6 that name the bank. */
export function saudiBankCodeOf(normalized: string): string {
  return normalized.slice(4, 6);
}

/** Groups of four, for reading back a number nobody memorises. */
export function formatSaudiIban(normalized: string): string {
  return normalized.replace(/(.{4})/g, "$1 ").trim();
}

export interface SaudiBank {
  /** The two-digit code as it appears in the IBAN. */
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn: string;
  /**
   * A bank that no longer trades under this name, and who absorbed it.
   *
   * OLD IBANs KEEP WORKING and keep their code, so the code has to keep
   * resolving. What is shown is the name on the number — a supplier
   * looking at their own account should recognise it — and the reader
   * is told where it went rather than being shown a bank that no longer
   * exists with no explanation.
   */
  readonly mergedIntoAr?: string;
  readonly mergedIntoEn?: string;
}

/**
 * THE SAMA BANK CODES.
 *
 * PROVENANCE, because a wrong name on a payout screen is a real
 * defect and not a cosmetic one. Nine of these were confirmed against
 * a published example IBAN or an IBAN-structure source independent of
 * the table they came from: 05, 10, 15, 20, 30, 45, 55, 60, 80 — which
 * covers every bank a Saudi company is likely to be paid into. The
 * remainder are the foreign and merged institutions, carried from a
 * single source and NOT independently confirmed; they are marked below.
 *
 * AN UNKNOWN CODE IS NOT AN ERROR. `saudiBankFromIban` returns null and
 * the caller shows "not identified" — it never guesses, and it never
 * refuses a number whose checksum is sound. A table that is missing a
 * new entrant must not be able to stop a supplier being paid.
 */
export const SAUDI_BANKS: Readonly<Record<string, SaudiBank>> = Object.freeze({
  // ---- confirmed against independent published examples ----
  "05": { code: "05", nameAr: "مصرف الإنماء", nameEn: "Alinma Bank" },
  "10": {
    code: "10",
    nameAr: "البنك الأهلي السعودي",
    nameEn: "Saudi National Bank",
  },
  "15": { code: "15", nameAr: "بنك البلاد", nameEn: "Bank AlBilad" },
  "20": { code: "20", nameAr: "بنك الرياض", nameEn: "Riyad Bank" },
  "30": { code: "30", nameAr: "البنك العربي الوطني", nameEn: "Arab National Bank" },
  "45": {
    code: "45",
    nameAr: "البنك السعودي البريطاني",
    nameEn: "Saudi British Bank (SABB)",
  },
  "55": {
    code: "55",
    nameAr: "البنك السعودي الفرنسي",
    nameEn: "Banque Saudi Fransi",
  },
  "60": { code: "60", nameAr: "بنك الجزيرة", nameEn: "Bank AlJazira" },
  "80": { code: "80", nameAr: "مصرف الراجحي", nameEn: "Al Rajhi Bank" },

  // ---- single source, not independently confirmed ----
  "40": {
    code: "40",
    nameAr: "سامبا",
    nameEn: "Samba Financial Group",
    mergedIntoAr: "البنك الأهلي السعودي",
    mergedIntoEn: "Saudi National Bank",
  },
  "50": {
    code: "50",
    nameAr: "بنك الأول",
    nameEn: "Alawwal Bank",
    mergedIntoAr: "البنك السعودي البريطاني",
    mergedIntoEn: "Saudi British Bank (SABB)",
  },
  "65": {
    code: "65",
    nameAr: "البنك السعودي للاستثمار",
    nameEn: "The Saudi Investment Bank",
  },
  "71": { code: "71", nameAr: "بنك البحرين الوطني", nameEn: "National Bank of Bahrain" },
  "75": { code: "75", nameAr: "بنك الكويت الوطني", nameEn: "National Bank of Kuwait" },
  "76": { code: "76", nameAr: "بنك مسقط", nameEn: "Bank Muscat" },
  "81": { code: "81", nameAr: "دويتشه بنك", nameEn: "Deutsche Bank" },
  "82": {
    code: "82",
    nameAr: "البنك الوطني الباكستاني",
    nameEn: "National Bank of Pakistan",
  },
  "83": { code: "83", nameAr: "بنك الدولة الهندي", nameEn: "State Bank of India" },
  "85": { code: "85", nameAr: "بي إن بي باريبا", nameEn: "BNP Paribas" },
  "86": { code: "86", nameAr: "جي بي مورغان تشيس", nameEn: "JPMorgan Chase Bank" },
  "90": {
    code: "90",
    nameAr: "بنك الخليج الدولي",
    nameEn: "Gulf International Bank",
  },
  "95": {
    code: "95",
    nameAr: "بنك الإمارات دبي الوطني",
    nameEn: "Emirates NBD",
  },
});

/**
 * The bank a well-formed IBAN names, or null.
 *
 * NULL HAS TWO CAUSES and the caller treats them the same way: the
 * number is not a valid Saudi IBAN, or its code is not in the table.
 * Neither is a reason to reject a payout account — see the note on
 * SAUDI_BANKS.
 */
export function saudiBankFromIban(normalized: string): SaudiBank | null {
  if (!isValidSaudiIban(normalized)) return null;
  return SAUDI_BANKS[saudiBankCodeOf(normalized)] ?? null;
}
