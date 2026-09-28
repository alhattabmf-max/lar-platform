import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { getBranding, brandName } from "./branding";

/**
 * WHAT A BROWSER TAB SAYS, AND WHERE THE PLATFORM'S NAME COMES FROM.
 *
 * Measured before this existed: 53 of the 85 pages rendered no `<title>`
 * tag at all — every public page, every sign-in page, and the whole of
 * the buyer's and the supplier's portals. Only the console's 32 pages
 * had one. A tab showed the URL, a bookmark had no name, and a screen
 * reader announced nothing on arrival.
 *
 * THE NAME IS THE TENANT'S, NOT A CONSTANT. «اجعل اسم المنصة يُجلب من
 * الاسم التجاري العربي والإنجليزي الموجودين فعلًا في إعدادات الهوية…
 * إذا غيّرت الاسم من لوحة الإدارة، تتغير عناوين الصفحات تبعًا له دون
 * تعديل الكود.» So it is read from branding, per locale, exactly as the
 * mark in the chrome already is.
 *
 * ONE FETCH PER REQUEST, NOT ONE PER CALLER. `getBranding` is wrapped in
 * React's `cache`, so the chrome's read and this one are the same read —
 * `generateMetadata` and the page body run inside one request, and the
 * second call returns the first one's promise.
 *
 * AND IT IS `no-store`, so renaming the platform shows on the next page
 * load rather than after a rebuild. That is `getBranding`'s existing
 * decision, taken because branding carries the live theme; a title is
 * simply one more thing that must not go stale.
 *
 * A MISSING NAME IS NOT A HOLE. `brandName` returns null when branding
 * has never been configured, and the fallback is a TRANSLATED string —
 * never `undefined`, never a message key.
 *
 * AND THE FALLBACK IS THE TRADE NAME, not «المنصة». The chrome says
 * «المنصة» in that case because its mark is standing in for a logo and
 * has no room for more; a browser tab has room for a name and a
 * bookmark needs one. `shell.platformNameFallback` carries it, per
 * locale, so the words are still not written into any page.
 */
export async function platformName(locale: AppLocale): Promise<string> {
  const [branding, shell] = await Promise.all([
    getBranding(locale),
    getTranslations({ locale, namespace: "shell" }),
  ]);
  return brandName(branding, locale) ?? shell("platformNameFallback");
}

/**
 * A page's own title, followed by the platform's name.
 *
 * ONE LINE PER PAGE, and that is the point: 53 copies of the same
 * `generateMetadata` body would be 53 places to keep in step. A page
 * says only which words name it.
 *
 *     export const generateMetadata = pageTitle("auth.login", "title");
 *
 * THE SEPARATOR IS A PIPE, matching the console's own titles, which
 * already read «سجل التدقيق | لوحة التحكم».
 */
export function pageTitle(
  namespace: string,
  key = "title",
): (args: { params: Promise<{ locale: string }> }) => Promise<Metadata> {
  return async ({ params }) => {
    const { locale } = await params;
    const appLocale = locale as AppLocale;

    const [name, t] = await Promise.all([
      platformName(appLocale),
      getTranslations({ locale: appLocale, namespace }),
    ]);

    return { title: `${t(key)} | ${name}` };
  };
}
