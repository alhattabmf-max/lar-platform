import { defineRouting } from "next-intl/routing";

/**
 * Bilingual architecture (Blueprint §3): ar-SA is the default locale
 * and is Arabic/RTL. en-SA is English/LTR. Both ship from day one —
 * neither is a "future" locale bolted on later.
 */
export const routing = defineRouting({
  locales: ["ar-SA", "en-SA"],
  defaultLocale: "ar-SA",
});

export type AppLocale = (typeof routing.locales)[number];
