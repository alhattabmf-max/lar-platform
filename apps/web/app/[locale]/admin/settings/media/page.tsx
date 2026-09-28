import { Suspense } from "react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/routing";
import { requireAdminOrRedirect } from "@/lib/admin-redirects";
import { loadMediaPolicy } from "@/lib/admin-data";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { SettingsGroupForm } from "@/components/admin/settings-group-form";

/**
 * What a product image is allowed to be.
 *
 * THE TYPE LIST CAN BE NARROWED, NEVER WIDENED. The three options are
 * the formats this platform can actually decode and resize; the DTO's
 * `@IsIn` refuses anything else. Offering a fourth checkbox would be
 * offering a setting the server exists to reject.
 *
 * SIZE IS IN BYTES because the bound is (102,400 and up). Showing
 * megabytes would mean multiplying on the way in and dividing on the
 * way out, and a stored 5,000,000 would come back as 4.77 and go back
 * as something else again.
 */
const IMAGE_TYPES = [
  { value: "image/jpeg", label: "JPEG" },
  { value: "image/png", label: "PNG" },
  { value: "image/webp", label: "WebP" },
] as const;


/**
 * The tab's name. The layout supplies « | لوحة التحكم ».
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale: locale as AppLocale,
    namespace: "admin.settings",
  });
  return { title: t("mediaGroup.title") };
}

export default async function AdminMediaSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const appLocale = locale as AppLocale;
  await requireAdminOrRedirect(appLocale);

  const t = await getTranslations({ locale: appLocale, namespace: "admin.settings" });
  const common = await getTranslations({ locale: appLocale, namespace: "common" });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-content">{t("mediaGroup.title")}</h1>
      </header>

      <Suspense fallback={<LoadingState label={common("loading")} rows={3} />}>
        <MediaGroup locale={appLocale} />
      </Suspense>
    </div>
  );
}

async function MediaGroup({ locale }: { locale: AppLocale }) {
  const t = await getTranslations({ locale, namespace: "admin.settings" });
  const states = await getTranslations({ locale, namespace: "states" });

  const media = await loadMediaPolicy();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("mediaPolicy.title")}</CardTitle>
      </CardHeader>
      <CardBody>
        {media.ok ? (
          <SettingsGroupForm
            path="/admin/settings/media-policy"
            initial={{ ...media.data }}
            labels={{
              save: t("save"),
              working: t("working"),
              saved: t("saved"),
              errorTitle: states("errorTitle"),
              requestIdLabel: states("requestIdLabel"),
              yes: t("yes"),
              no: t("no"),
            }}
            fields={[
              {
                kind: "int",
                name: "maxSizeBytes",
                label: t("mediaPolicy.maxSizeBytes"),
                unit: t("unit.bytes"),
                min: 102400,
              },
              {
                kind: "int",
                name: "maxImagesPerProduct",
                label: t("mediaPolicy.maxImagesPerProduct"),
                min: 1,
                max: 30,
              },
              {
                kind: "int",
                name: "maxPixels",
                label: t("mediaPolicy.maxPixels"),
                unit: t("unit.pixels"),
                min: 1000000,
                max: 100000000,
              },
              {
                kind: "multi",
                name: "allowedTypes",
                label: t("mediaPolicy.allowedTypes"),
                options: IMAGE_TYPES,
              },
            ]}
          />
        ) : (
          <ErrorState
            title={states("errorTitle")}
            description={states("errorDescription")}
            requestId={media.error.requestId}
            requestIdLabel={states("requestIdLabel")}
          />
        )}
      </CardBody>
    </Card>
  );
}
