import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import messages from "../messages/ar-SA.json";
import {
  BannerManager,
  type BannerManagerLabels,
} from "@/components/admin/banner-manager";
import type { AdminBannerRow } from "@/lib/admin-data";

/**
 * Renders the banners screen the way the route does.
 *
 * `/ar-SA/admin/banners` returned "Application error: a server-side
 * exception has occurred" (digest `1046837119`) because the page handed
 * this component three FUNCTIONS — `moveUp`, `moveDown`, `stateLabel` —
 * and React cannot serialize a function across the server/client
 * boundary. `server-client-boundary.test.ts` forbids that shape
 * repo-wide; this file proves the replacement actually renders, which a
 * static scan cannot show.
 *
 * The three removed labels are now resolved from `useTranslations()`
 * inside the component, so this wraps it in the same
 * `NextIntlClientProvider` the real layout provides, with the REAL
 * `ar-SA` messages. A missing or misnamed key fails here rather than
 * shipping as a raw key on the screen.
 */

// The component calls router.refresh() after a mutation; the app router
// is not mounted under jsdom. Same shape the other component tests use.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const BANNERS: AdminBannerRow[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    placement: "PUBLIC_HOME",
    titleAr: "عرض الأسمنت",
    titleEn: "Cement offer",
    bodyAr: null,
    bodyEn: null,
    linkUrl: null,
    sortOrder: 1,
    isActive: true,
    startsAt: null,
    endsAt: null,
    hasImage: false,
    state: "LIVE",
    imageWidth: null,
    imageHeight: null,
    createdAt: "2026-08-23T10:00:00.000Z",
    updatedAt: "2026-08-23T10:00:00.000Z",
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    placement: "PUBLIC_HOME",
    titleAr: "عرض الحديد",
    titleEn: "Steel offer",
    bodyAr: null,
    bodyEn: null,
    linkUrl: null,
    sortOrder: 2,
    isActive: false,
    startsAt: null,
    endsAt: null,
    hasImage: false,
    // A REAL member of the state vocabulary. An invented one would make
    // next-intl echo the key path, which is what a missing translation
    // looks like — the test must not manufacture that itself.
    state: "INACTIVE",
    imageWidth: null,
    imageHeight: null,
    createdAt: "2026-08-23T10:00:00.000Z",
    updatedAt: "2026-08-23T10:00:00.000Z",
  },
];

/**
 * Exactly what the page now passes — no function anywhere. Typed as
 * `BannerManagerLabels`, so if anyone re-adds a function-valued member
 * to that interface, this object stops compiling.
 */
const LABELS: BannerManagerLabels = {
  createLegend: "إضافة لافتة",
  titleAr: "العنوان بالعربية",
  titleEn: "العنوان بالإنجليزية",
  bodyAr: "النص بالعربية",
  bodyEn: "النص بالإنجليزية",
  linkUrl: "الرابط",
  linkHint: "رابط داخلي فقط",
  create: "إنشاء",
  saveOrder: "حفظ الترتيب",
  orderChanged: "تغيّر الترتيب",
  orderSaved: "حُفظ الترتيب",
  activate: "تفعيل",
  deactivate: "إيقاف",
  hasImage: "بها صورة",
  noImage: "بلا صورة",
  scheduleFrom: "من",
  scheduleTo: "إلى",
  saveSchedule: "حفظ الجدولة",
  scheduleHint: "اتركه فارغًا ليظل دائمًا",
  working: "جارٍ التنفيذ",
  required: "مطلوب",
  empty: "لا توجد لافتات",
  errorTitle: "تعذّر التنفيذ",
  requestIdLabel: "رقم الطلب",
};

function renderManager() {
  return render(
    <NextIntlClientProvider locale="ar-SA" messages={messages}>
      <BannerManager placement="PUBLIC_HOME" banners={BANNERS} labels={LABELS} />
    </NextIntlClientProvider>
  );
}

describe("admin banners screen", () => {
  it("renders without throwing — the page no longer 500s", () => {
    expect(() => renderManager()).not.toThrow();
  });

  it("offers the create form, so a banner can be added from the UI", () => {
    renderManager();

    // Substring matchers: the accessible name also carries the required
    // marker the form appends.
    expect(screen.getByLabelText(new RegExp(LABELS.titleAr))).toBeTruthy();
    expect(screen.getByLabelText(new RegExp(LABELS.titleEn))).toBeTruthy();
    expect(screen.getByRole("button", { name: LABELS.create })).toBeTruthy();
  });

  it("resolves the three formerly-function labels from real messages", () => {
    renderManager();

    // stateLabel: a translated state, never the raw enum.
    const live = messages.admin.vocab.bannerState.LIVE;
    const inactive = messages.admin.vocab.bannerState.INACTIVE;
    expect(live).toBeTruthy();
    expect(inactive).toBeTruthy();
    expect(screen.getAllByText(live).length).toBeGreaterThan(0);
    expect(screen.getAllByText(inactive).length).toBeGreaterThan(0);
    // The raw enum must never reach the screen.
    expect(screen.queryByText("LIVE")).toBeNull();
    expect(screen.queryByText("INACTIVE")).toBeNull();

    // moveUp / moveDown: an accessible name carrying the banner's title,
    // which is the whole reason they needed an argument.
    const up = screen.getAllByRole("button", { name: /عرض الأسمنت/ });
    expect(up.length).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("button", { name: /عرض الحديد/ }).length
    ).toBeGreaterThan(0);
  });

  it("renders no untranslated message key", () => {
    const { container } = renderManager();
    // next-intl echoes a missing key as its dotted path.
    expect(container.textContent).not.toMatch(/admin\.banners\./);
    expect(container.textContent).not.toMatch(/admin\.vocab\./);
  });
});
