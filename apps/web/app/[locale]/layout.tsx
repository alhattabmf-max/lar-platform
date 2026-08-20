import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { notFound } from "next/navigation";
import { getMessages } from "next-intl/server";
import { routing, type AppLocale } from "@/i18n/routing";
import { AppShell } from "@/components/shell/app-shell";
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

  return (
    <html lang={appLocale} dir={dir}>
      <body>
        <NextIntlClientProvider locale={appLocale} messages={messages}>
          <AppShell locale={appLocale}>{children}</AppShell>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
