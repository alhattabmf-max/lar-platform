import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { notFound } from "next/navigation";
import { getMessages } from "next-intl/server";
import { routing, type AppLocale } from "@/i18n/routing";
import "../globals.css";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

const RTL_LOCALES: readonly AppLocale[] = ["ar-SA"];

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!routing.locales.includes(locale as AppLocale)) {
    notFound();
  }

  const appLocale = locale as AppLocale;
  const dir = RTL_LOCALES.includes(appLocale) ? "rtl" : "ltr";
  const messages = await getMessages({ locale: appLocale });

  // `lang` and `dir` live here and ONLY here. Every route group nests
  // inside this layout, so the document direction is set once and no
  // group can disagree with another about it.
  //
  // The page frame is deliberately NOT applied at this level: (public)
  // wraps its pages in the full AppShell, (auth) in the chrome-less
  // MinimalShell. Both still receive the locale, the direction, the
  // branding and the active theme.
  return (
    <html lang={appLocale} dir={dir}>
      <body>
        <NextIntlClientProvider locale={appLocale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
