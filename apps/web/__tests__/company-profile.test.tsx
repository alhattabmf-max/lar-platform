import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import messages from "@/messages/ar-SA.json";
import en from "@/messages/en-SA.json";
import {
  missingRequirements,
  profileState,
  requirementsFor,
} from "@platform/types";
import { looksLikeAPlace } from "@/lib/map-link";
import { ApiError } from "@/lib/errors";
import { CompanyRecordCard } from "@/components/company/company-record-card";
import { CompletenessBanner } from "@/components/company/completeness-banner";

/**
 * «بيانات المنشأة» — the one place a company completes its own record.
 *
 * WHAT THIS REPLACED. Every account screen in both portals was
 * read-only: no form, no button, no write call anywhere. That is why a
 * separate «إكمال الملف الشخصي» page had to exist, and why a supplier
 * looking for «إضافة حساب بنكي» found a status panel and no way to add
 * one.
 *
 * IT IS ONE CARD NOW, and one «تعديل البيانات». It was five cards with
 * five buttons, running to three screens; the approved reference draws
 * a single card and this file follows it. Every rule the five held —
 * the position is a pin, a contact is a name AND a number, a bank is
 * read out of its IBAN, a coordinate is never typed — is re-stated
 * against the one card that now owns it rather than lost with them.
 */

const ROOT = join(__dirname, "..");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");
const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, replace: vi.fn(), push: vi.fn() }),
}));

/**
 * LEAFLET, STUBBED — not the picker.
 *
 * Mocking the picker component would test that the card renders a
 * component, which is nothing. Mocking the MAP LIBRARY leaves the
 * picker's own code running — its state, its rounding, its confirm
 * button, and what it hands back — while the one thing jsdom cannot do
 * (measure a tile pane) is a stub. `moved` reaches into the handler
 * Leaflet would have called on a drag.
 */
let moveMarker: ((lat: number, lng: number) => void) | null = null;
vi.mock("leaflet", () => {
  const marker = {
    _at: { lat: 0, lng: 0 },
    _handlers: {} as Record<string, () => void>,
    addTo() {
      return this;
    },
    on(event: string, handler: () => void) {
      this._handlers[event] = handler;
    },
    getLatLng() {
      return this._at;
    },
    setLatLng(next: [number, number] | { lat: number; lng: number }) {
      this._at = Array.isArray(next) ? { lat: next[0], lng: next[1] } : next;
    },
  };
  const map = {
    on: vi.fn(),
    setView: vi.fn(),
    invalidateSize: vi.fn(),
    remove: vi.fn(),
  };
  moveMarker = (lat, lng) => {
    marker.setLatLng({ lat, lng });
    marker._handlers.dragend?.();
  };
  return {
    default: {
      map: () => map,
      tileLayer: () => ({ addTo: () => undefined }),
      divIcon: () => ({}),
      marker: () => marker,
    },
  };
});

const post = vi.fn();
const put = vi.fn();
const patch = vi.fn();
const del = vi.fn();
/**
 * THE CITY LIST IS READ IN THE BROWSER NOW, and this mock is how that
 * is exercised: the card asks `GET /cities/active` on mount, so an
 * administrator's switch shows up on the next read rather than after
 * a five-minute cache — and without re-rendering the page, which
 * would throw away everything typed.
 */
const get = vi.fn();
vi.mock("@/lib/api-client", () => ({
  apiClient: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
    put: (...args: unknown[]) => put(...args),
    patch: (...args: unknown[]) => patch(...args),
    delete: (...args: unknown[]) => del(...args),
  },
  downloadFile: vi.fn(),
  uploadFile: vi.fn(),
}));

function wrap(node: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="ar-SA" messages={messages}>
      {node}
    </NextIntlClientProvider>,
  );
}

const REGION_ID = "22222222-2222-2222-2222-222222222222";

const REGIONS = [
  { id: REGION_ID, name: "منطقة الرياض", alternateName: "Riyadh Region" },
];

const CITIES = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    regionId: REGION_ID,
    name: "الرياض",
    group: "منطقة الرياض",
    alternateName: "Riyadh",
  },
];

/** The two cities the live read answers with, in API shape. */
const LIVE_CITIES = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    nameAr: "الرياض",
    nameEn: "Riyadh",
    region: {
      id: "22222222-2222-2222-2222-222222222222",
      nameAr: "منطقة الرياض",
      nameEn: "Riyadh Region",
    },
  },
];

beforeEach(() => {
  refresh.mockReset();
  get.mockReset().mockResolvedValue(LIVE_CITIES);
  post.mockReset().mockResolvedValue({});
  put.mockReset().mockResolvedValue({});
  patch.mockReset().mockResolvedValue({});
  del.mockReset().mockResolvedValue({});
});

// ---------------------------------------- every private read is a read
//                                            AS THE SIGNED-IN COMPANY

describe("the section reads as the company, never anonymously", () => {
  const data = read("lib/company-profile-data.ts");

  it("forwards the session cookie on every read", () => {
    // A Server Component has no cookie jar: `fetch` on the server sends
    // nothing unless the caller attaches it. Leaving it out is SILENT —
    // every read comes back 401 and the section renders its error
    // state, which is exactly what the first real request did.
    // ONE `load` HELPER, and it attaches the header. Every reader in
    // this module goes through it, so there is one place to get right
    // rather than one per endpoint.
    expect(data).toContain("cookieHeader: await cookieHeader()");

    const directCalls = [...data.matchAll(/apiClient\.\w+</g)];
    expect(directCalls).toHaveLength(1);
  });

  it("never caches one company's answer for another", () => {
    expect(data).toContain('cache: "no-store"');
    expect(data).not.toContain("revalidate");
  });

  it("strips the stored coordinates before they reach the page", () => {
    // A TYPE STRIPS NOTHING AT RUN TIME. `CompanyBranch` declares no
    // latitude and no longitude, and the endpoint returns both — so
    // they travelled into the payload and sat in the HTML of a screen
    // whose whole point is that a position is a link, never a pair of
    // numbers. Each row is rebuilt from the fields the portal renders.
    expect(data).toContain("loadCompanyBranches");
    expect(data).toContain("result.data.map((row) => ({");
    expect(data).not.toContain("latitude: row");
  });

  it("reads no admin endpoint and no admin loader", () => {
    expect(data).not.toContain("/admin/");
    expect(data).not.toContain("admin-data");
  });
});

// ------------------------------------------------ 10. the one criterion

describe("what completeness means, from one definition", () => {
  it("asks a BUYER for its record and its main branch, and nothing else", () => {
    expect(requirementsFor("TRADER")).toEqual(["companyDetails", "mainBranch"]);
  });

  it("asks a SUPPLIER for a bank account and a billing identity as well", () => {
    // A supplier is PAID, and money cannot be sent to a company that
    // has given no account to send it to — nor a commission document
    // issued to one that has not said who it is addressed to.
    expect(requirementsFor("SUPPLIER")).toEqual([
      "companyDetails",
      "mainBranch",
      "bankAccount",
      "billingIdentity",
    ]);
  });

  it("never holds a buyer back for a bank account it will never have", () => {
    const buyer = profileState("TRADER", {
      hasCompanyDetails: true,
      hasMainBranch: true,
      hasBankAccount: false,
        hasBillingIdentity: false,
    });

    expect(buyer.complete).toBe(true);
    expect(buyer.missing).toEqual([]);
  });

  it("holds a supplier with the SAME facts back, for exactly that reason", () => {
    const supplier = profileState("SUPPLIER", {
      hasCompanyDetails: true,
      hasMainBranch: true,
      hasBankAccount: false,
        hasBillingIdentity: false,
    });

    expect(supplier.complete).toBe(false);
    // BOTH, because the facts say neither is there. The buyer above is
    // complete on the same facts; the difference is the two items only
    // a supplier is asked for.
    expect(supplier.missing).toEqual(["bankAccount", "billingIdentity"]);
  });

  it("names what is missing rather than only saying that something is", () => {
    expect(
      missingRequirements("SUPPLIER", {
        hasCompanyDetails: false,
        hasMainBranch: false,
        hasBankAccount: false,
        hasBillingIdentity: false,
      }),
    ).toEqual([
      "companyDetails",
      "mainBranch",
      "bankAccount",
      "billingIdentity",
    ]);
  });

  it("derives `complete` from `missing`, so the two cannot disagree", () => {
    for (const facts of [
      { hasCompanyDetails: true, hasMainBranch: true, hasBankAccount: true, hasBillingIdentity: true },
      { hasCompanyDetails: true, hasMainBranch: false, hasBankAccount: true, hasBillingIdentity: true },
      { hasCompanyDetails: false, hasMainBranch: false, hasBankAccount: false, hasBillingIdentity: false },
    ]) {
      const state = profileState("SUPPLIER", facts);
      expect(state.complete).toBe(state.missing.length === 0);
    }
  });
});

// ------------------------------------------- 5. incomplete, not blocked

describe("an incomplete record is a notice, never a gate", () => {
  it("names each missing item and links it to its own section", () => {
    wrap(
      <CompletenessBanner
        missing={["mainBranch", "bankAccount"]}
        href="/ar-SA/supplier/account"
        labels={{
          title: "بيانات منشأتك غير مكتملة",
          action: "استكمال بيانات المنشأة",
          requirements: {
            companyDetails: "تفاصيل المنشأة",
            mainBranch: "الفرع الرئيسي",
            bankAccount: "الحساب البنكي",
            billingIdentity: "الفوترة والضريبة",
          },
        }}
      />,
    );

    expect(screen.getByTestId("missing-mainBranch")).toHaveAttribute(
      "href",
      "/ar-SA/supplier/account#company-branches",
    );
    expect(screen.getByTestId("missing-bankAccount")).toHaveAttribute(
      "href",
      "/ar-SA/supplier/account#company-bank-account",
    );
    expect(screen.getByTestId("complete-company-profile")).toHaveAttribute(
      "href",
      "/ar-SA/supplier/account",
    );
  });

  it("says nothing at all when nothing is missing", () => {
    wrap(
      <CompletenessBanner
        missing={[]}
        href="/ar-SA/trader/account"
        labels={{
          title: "غير مكتملة",
          action: "استكمال",
          requirements: {
            companyDetails: "a",
            mainBranch: "b",
            bankAccount: "c",
            billingIdentity: "الفوترة والضريبة",
          },
        }}
      />,
    );

    expect(screen.queryByTestId("completeness-banner")).toBeNull();
  });

  it("carries no dismiss control", () => {
    // A notice somebody can close is a notice that stops being true
    // without anything changing, and the next screen would still
    // refuse the work.
    //
    // COMMENTS STRIPPED FIRST: the component's own note explains why
    // there is no dismiss control, and scanning the prose would fail on
    // the word that says the rule is kept.
    const source = strip(read("components/company/completeness-banner.tsx"));

    expect(source).not.toMatch(/dismiss|onClose|setOpen/i);
  });

  it("blocks no portal route on an incomplete record", () => {
    // Signing in, reaching a dashboard, changing language and signing
    // out are never withheld for it.
    const guards = read("lib/auth-redirects.ts");

    expect(guards).not.toContain("completeProfilePath");
    expect(guards).not.toMatch(/if \(!session\.profile/);
  });

  it("has no separate completion page left anywhere", () => {
    const routes = readdirSync(join(ROOT, "app", "[locale]"));

    expect(routes).not.toContain("complete-profile");
  });
});

// ------------------------------------------- 7 & 8. the branch position

// ================== 7–12. THE ONE CARD, AND THE ONE EDIT BUTTON ======
//
// WHAT THIS BLOCK REPLACED. The record used to be five cards, each
// with its own «تعديل» and its own save, tested separately. Every rule
// those cases held is re-stated here against the ONE card that now
// owns it — the position is a pin, a contact is a name AND a number, a
// bank is read out of its IBAN — because the rules did not change;
// only how many buttons a company has to press to keep them.

const RECORD_LABELS: React.ComponentProps<
  typeof CompanyRecordCard
>["labels"] = {
  crNumber: "رقم السجل التجاري",
  statusInProgress: "قيد الاستكمال",
  statusVerified: "منشأة موثقة",
  statusUnderReview: "جاري التوثيق",
  lockedNotice: "تُدار من الإدارة",

  legalName: "اسم المنشأة",
  email: "البريد الإلكتروني",
  emailInvalid: "صيغة البريد غير صحيحة.",
  emailReverify: "تغيير البريد يتطلّب تأكيده من جديد.",
  vatNumber: "الرقم الضريبي",
  vatNumberHint: "١٥ رقمًا.",
  vatNotRegistered: "غير مسجّلة في الضريبة",
  vatNumberInvalid: "رقم ضريبي غير صحيح",
  iban: "الآيبان",
  ibanInvalid: "رقم الآيبان غير صحيح",
  ibanOnFile: "الحساب المسجّل ينتهي بـ",
  endingIn: "ينتهي بـ",
  bankName: "اسم البنك",
  bankAutoDetected: "تم التعرّف تلقائيًا",
  bankPending: "سيظهر اسم البنك تلقائيًا",
  bankNotIdentified: "لم يتم التعرّف على البنك",
  accountHolder: "اسم المستفيد",
  accountHolderPlaceholder: "أدخل اسم المستفيد",
  notEntered: "لم يُدخل بعد",
  required: "(مطلوب)",

  reverifies: "تعديله يتطلّب إعادة توثيق",

  contactsTitle: "أرقام التواصل",
  contactsEmpty: "لا توجد أرقام تواصل.",
  addContact: "إضافة رقم تواصل",
  removeContact: "حذف رقم التواصل",
  contactName: "اسم مسؤول التواصل",

  extraBranchesTitle: "فروع إضافية (اختيارية)",
  extraBranchesEmpty: "لا توجد فروع إضافية.",
  branchesTitle: "الفروع",
  branchesEmpty: "لم تُضَف أي فروع بعد.",
  addBranch: "إضافة فرع",
  removeBranch: "حذف الفرع",
  branchName: "اسم الفرع",
  branchContactName: "اسم مسؤول الفرع",
  mainBranch: "الفرع الرئيسي",
  region: "المنطقة",
  regionPlaceholder: "ابحث عن منطقة",
  regionNoMatch: "لا توجد منطقة بهذا الاسم",
  city: "المدينة",
  cityPlaceholder: "ابحث عن مدينة",
  cityNoMatch: "لا توجد مدينة بهذا الاسم",
  cityNeedsRegion: "اختر المنطقة أولًا",
  shortAddress: "العنوان الوطني المختصر",
  position: "موقع المنشأة",
  positionEmpty: "لم يُحدَّد الموقع بعد",
  addPosition: "إضافة الموقع",
  pickPosition: "تحديد الموقع",
  changePosition: "تغيير الموقع",
  regionAndCity: "المنطقة والمدينة",
  cityOptionalPlaceholder: "المدينة (اختياري)",
  picker: {
    title: "حدّد موقع الفرع",
    hint: "اسحب الدبوس.",
    confirm: "اعتماد الموقع",
    cancel: "إلغاء",
    useMyLocation: "موقعي الحالي",
    locating: "جارٍ…",
    locateFailed: "تعذّر تحديد موقعك.",
    coordinates: "الإحداثيات:",
    searchPlaceholder: "ابحث باسم المكان",
    search: "بحث",
    searchFailed: "لم يُعثر على مكان.",
    mapUnavailable: "تعذّر تحميل الخريطة.",
    usingOpenStreetMap: "خرائط قوقل غير مُفعّلة بعد.",
  },

  back: "العودة",
  edit: "تعديل البيانات",
  saveChanges: "حفظ التغييرات",
  cancel: "إلغاء",
  submit: "إرسال للتوثيق",
  working: "جارٍ…",
  reviewNote: "راجع البيانات قبل الإرسال.",
  editNote: "ضغطة واحدة تحفظ كل ما غيّرته.",
  requestIdLabel: "المرجع",
  fieldNames: {
    email: "البريد الإلكتروني",
    accountHolderName: "اسم صاحب الحساب",
    iban: "رقم الآيبان",
    vatNumber: "الرقم الضريبي",
    shortAddress: "العنوان الوطني المختصر",
    regionId: "المنطقة",
    contactPhone: "رقم التواصل",
  },

  blockedTitle: "لإتمام الحفظ يلزم:",
  blockEmailMissing: "إدخال البريد الإلكتروني.",
  blockEmailInvalid: "بريد إلكتروني بصيغة صحيحة.",
  blockVatMissing: "إدخال الرقم الضريبي.",
  blockVatInvalid: "الرقم الضريبي يجب أن يكون ١٥ رقمًا.",
  blockIbanInvalid: "رقم آيبان صحيح.",
  blockAccountHolder: "إدخال اسم صاحب الحساب مع رقم الآيبان.",
  blockIbanMissing: "إدخال رقم الآيبان مع اسم صاحب الحساب.",
  blockAddress: "إدخال العنوان الوطني المختصر.",
  blockRegion: "اختيار المنطقة.",
  blockPosition: "تحديد موقع المنشأة.",
  blockExtraBranch: "استكمال الفروع الإضافية.",
  blockContact: "استكمال جهات التواصل.",
};

const SAVED_BRANCH = {
  id: "branch-1",
  regionId: REGION_ID,
  cityId: CITIES[0].id,
  name: "الفرع الرئيسي",
  shortAddress: "RRRD2929",
  contactName: "سارة",
  contactPhone: "0500000000",
  isDefault: true,
  latitude: 24.7136,
  longitude: 46.6753,
};

const SAVED_CONTACT = {
  id: "contact-1",
  name: "شركة الاختبار",
  phone: "0500000000",
  email: null,
  isActive: true,
};

function renderRecord(
  overrides: Partial<React.ComponentProps<typeof CompanyRecordCard>> = {},
) {
  return wrap(
    <CompanyRecordCard
      company={{ legalName: "مؤسسة الاختبار", crNumber: "1010101010" }}
      email="owner@example.com"
      billing={{
        // Already the legal name, so an untouched save writes nothing.
        invoicingLegalName: "مؤسسة الاختبار",
        isVatRegistered: true,
        vatNumber: "310123456700003",
      }}
      bank={null}
      branches={[]}
      contacts={[SAVED_CONTACT]}
      regions={REGIONS}
      cities={CITIES}
      isSupplier
      verified={false}
      underReview={false}
      met={1}
      total={4}
      canSubmit={false}
      locked={false}
      backHref="/ar-SA/supplier"
      labels={RECORD_LABELS}
      {...overrides}
    />,
  );
}

describe("the identity goes up into the tab's strip", () => {
  /**
   * «بيانات المنشأة في بطاقة داكنة — ألغِ البطاقة الداكنة وانقل اللي
   * فيها للشريط لسان بيانات المنشأة… بدون ما تزود في ارتفاع الشريط أو
   * نزوله للأسفل».
   *
   * The name, the state it is in and the registration number are read
   * at a glance and never edited here, and the strip directly above
   * this card had room for all three.
   */
  it("renders into the strip when the chrome draws one", () => {
    const slot = document.createElement("div");
    slot.id = "portal-strip-slot";
    document.body.append(slot);

    try {
      renderRecord({ identityInStrip: true });

      const band = screen.getByTestId("company-identity-band");
      expect(slot.contains(band)).toBe(true);
      // THE NAME AND ITS STANDING, and nothing else — «نزّل رقم
      //  السجل التجاري الجدول في البطاقة اللي تحت عشان يعطي مجال
      //  للاسم، لأن الاسم يظهر نصفه فقط». The label, the digits and
      // the lock came to about a hundred and seventy pixels of a
      // phone's width, and the name — which is what the strip is
      // for — was truncated to half of itself.
      expect(band.textContent).toContain("مؤسسة الاختبار");
      expect(band.textContent).not.toContain("1010101010");
      expect(within(band).getByTestId("identity-status")).toBeInTheDocument();
      // AND THE STANDING IS A MARK, NOT A WORD — «بدل كلمة منشأة
      //  موثقة نكتفي بالصح الأخضر جنب الاسم». The word survives for
      // a reader who cannot see the mark.
      const mark = within(band).getByTestId("identity-status");
      expect(mark.className).toContain("size-5");
      expect(mark.textContent).toContain("قيد الاستكمال");
    } finally {
      slot.remove();
    }
  });

  it("adds no height to it: one line, and nothing wraps", () => {
    const slot = document.createElement("div");
    slot.id = "portal-strip-slot";
    document.body.append(slot);

    try {
      renderRecord({ identityInStrip: true });
      const band = screen.getByTestId("company-identity-band");

      // A wrapping row is a row that can become two.
      expect(band.className).toContain("whitespace-nowrap");
      expect(band.className).not.toContain("flex-wrap");
      // The label sits BEFORE its value rather than above it, which is
      // the whole of what made the band two rows tall.
      expect(band.className).not.toContain("flex-col");
      for (const child of Array.from(band.children)) {
        expect(child.className).not.toContain("flex-col");
      }
      // Only the name may shrink; nothing else is allowed to reflow.
      expect(within(band).getByTestId("identity-status").className).toContain("shrink-0");
    } finally {
      slot.remove();
    }
  });

  it("keeps its own band where there is no strip — the buyer's portal", () => {
    // «لا تعمّم التصميم إلا بموافقتي الصريحة». The same card serves the
    // buyer, whose chrome draws no such row; there the navy band it
    // always had is what it keeps.
    expect(document.getElementById("portal-strip-slot")).toBeNull();

    renderRecord();
    const band = screen.getByTestId("company-identity-band");

    expect(band.className).toContain("bg-primary");
    expect(band.className).toContain("rounded-t-card");
  });
});

/** Open the card for editing — the one gesture everything else needs. */
async function edit(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId("record-edit"));
}

/** Drag the pin and confirm it. The main branch's button has no index. */
async function placePin(
  user: ReturnType<typeof userEvent.setup>,
  index: number | null = null,
  lat = 24.774265,
  lng = 46.738586,
) {
  await user.click(
    screen.getByTestId(
      index === null ? "record-pick-location" : `record-pick-location-${index}`,
    ),
  );
  expect(await screen.findByTestId("picker-map")).toBeInTheDocument();
  await waitFor(() =>
    expect(screen.getByTestId("picker-confirm")).toBeEnabled(),
  );
  moveMarker?.(lat, lng);
  await user.click(screen.getByTestId("picker-confirm"));
}

/**
 * The main branch, in full: an address and a region.
 *
 * IT HAS NO NAME FIELD AND NO CONTACT FIELD. It is «الفرع الرئيسي» by
 * definition, and its contact is the company's own first contact —
 * both written for the company rather than asked for a second time.
 */
async function fillMainBranch(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByTestId("record-short-address"), "RRRD2929");
  await pickGridRegion(user, REGIONS[0].name);
}

async function pickGridRegion(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
) {
  await user.click(screen.getByTestId("record-region"));
  await user.type(screen.getByTestId("record-region"), name);
  await user.click(await screen.findByRole("option", { name: new RegExp(name) }));
}

describe("ONE card, ONE edit button", () => {
  it("is a single card, not a stack of them", () => {
    renderRecord();

    expect(screen.getAllByTestId("company-record-card")).toHaveLength(1);
    // The five it replaced are gone, not hidden.
    expect(screen.queryByTestId("card-company-details")).toBeNull();
    expect(screen.queryByTestId("card-company-branches")).toBeNull();
    expect(screen.queryByTestId("card-company-bank")).toBeNull();
  });

  it("offers exactly one control to change any of it", () => {
    renderRecord();

    expect(screen.getAllByTestId("record-edit")).toHaveLength(1);
    // Nothing is a field until that one button is pressed.
    expect(screen.queryByTestId("record-invoicing-name")?.tagName).not.toBe(
      "INPUT",
    );
  });

  it("turns every value into a field IN PLACE, and back again", async () => {
    const user = userEvent.setup();
    renderRecord();

    await edit(user);
    // The same card — what changed is what is inside it.
    expect(screen.getAllByTestId("company-record-card")).toHaveLength(1);
    expect(screen.getByTestId("record-email").tagName).toBe("INPUT");
    expect(screen.getByTestId("record-save")).toBeInTheDocument();
    expect(screen.queryByTestId("record-edit")).toBeNull();

    await user.click(screen.getByTestId("record-cancel"));
    expect(screen.getByTestId("record-edit")).toBeInTheDocument();
    expect(screen.queryByTestId("record-save")).toBeNull();
  });

  it("puts back what was there when an edit is cancelled", async () => {
    const user = userEvent.setup();
    renderRecord({
      billing: {
        invoicingLegalName: "مؤسسة الإمداد",
        isVatRegistered: true,
        vatNumber: "310123456700003",
      },
    });

    await edit(user);
    await user.clear(screen.getByTestId("record-email"));
    await user.type(screen.getByTestId("record-email"), "other@example.com");
    await user.click(screen.getByTestId("record-cancel"));

    expect(screen.getByTestId("record-email")).toHaveTextContent(
      "owner@example.com",
    );
    expect(put).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });

  it("offers NO way in while an administrator has the record open", () => {
    // Every path behind the button refuses then, and a button that
    // only produces a refusal is worse than no button.
    renderRecord({ locked: true });

    expect(screen.queryByTestId("record-edit")).toBeNull();
  });

  it("always offers a way back", () => {
    renderRecord();

    expect(screen.getByTestId("record-back")).toHaveAttribute(
      "href",
      "/ar-SA/supplier",
    );
  });
});

describe("the badge is the server's word, never a count", () => {
  /**
   * THE FAULT THIS FIXES. An approved company was shown «مكتملة» over
   * a percentage — a statement about how much of a FORM was filled in,
   * beside a company that had been approved weeks earlier. Completion
   * and APPROVAL are different facts, and only the server holds the
   * second.
   */
  it("reads «قيد الاستكمال» before anything is sent", () => {
    renderRecord({ verified: false, underReview: false });

    expect(screen.getByTestId("identity-status")).toHaveTextContent(
      RECORD_LABELS.statusInProgress,
    );
  });

  it("reads «جاري التوثيق» ONLY while a request is under review", () => {
    renderRecord({ verified: false, underReview: true });

    expect(screen.getByTestId("identity-status")).toHaveTextContent(
      RECORD_LABELS.statusUnderReview,
    );
  });

  it("reads «منشأة موثقة» once the SERVER says so", () => {
    renderRecord({ verified: true, underReview: false });

    expect(screen.getByTestId("identity-status")).toHaveTextContent(
      RECORD_LABELS.statusVerified,
    );
  });

  it("does NOT say «جاري التوثيق» for a complete record nobody has sent", () => {
    // A record that is finished and unsent is a thing the company must
    // still act on; a badge saying it is in progress would stop them.
    renderRecord({ verified: false, underReview: false, met: 4, total: 4 });

    expect(screen.getByTestId("identity-status")).not.toHaveTextContent(
      RECORD_LABELS.statusUnderReview,
    );
    expect(screen.getByTestId("identity-status")).toHaveTextContent(
      RECORD_LABELS.statusInProgress,
    );
  });

  it("does NOT say «منشأة موثقة» just because the count reached 100%", () => {
    renderRecord({ verified: false, underReview: false, met: 4, total: 4 });

    expect(screen.getByTestId("identity-status")).not.toHaveTextContent(
      RECORD_LABELS.statusVerified,
    );
  });

  it("carries NO completion percentage in the band any more", () => {
    // It answered a different question from the one the badge asks,
    // and «100%» beside an approved company's name said nothing.
    renderRecord({ verified: true, underReview: false, met: 4, total: 4 });

    const band = screen.getByTestId("company-identity-band");
    expect(band.textContent).not.toMatch(/%/);
  });

  it("shows the registration number LOCKED, and offers no field for it", async () => {
    // IN THE TABLE NOW, not in the strip — see the block below for why.
    // What has not changed is that it can never be typed.
    const user = userEvent.setup();
    renderRecord();

    expect(screen.getByTestId("record-cr-number")).toHaveTextContent(
      "1010101010",
    );
    await edit(user);
    expect(screen.getByTestId("record-cr-number").tagName).not.toBe("INPUT");
  });

  it("shows the legal name ONCE — in the band, never again in the body", async () => {
    const user = userEvent.setup();
    renderRecord();

    expect(screen.getByTestId("identity-legal-name")).toHaveTextContent(
      "مؤسسة الاختبار",
    );
    expect(screen.queryByTestId("record-legal-name")).toBeNull();
    await edit(user);
    expect(screen.queryByTestId("record-legal-name")).toBeNull();
  });

  it("labels the name in the band, level with the registration number", () => {
    renderRecord();

    expect(screen.getByText(RECORD_LABELS.legalName)).toBeInTheDocument();
    expect(screen.getByText(RECORD_LABELS.crNumber)).toBeInTheDocument();
  });
});

describe("what a buyer is asked for, and what it is not", () => {
  it("shows a buyer no bank fields at all", async () => {
    const user = userEvent.setup();
    renderRecord({ isSupplier: false, billing: null, met: 1, total: 2 });

    await edit(user);
    expect(screen.queryByTestId("record-iban")).toBeNull();
    expect(screen.queryByTestId("record-bank")).toBeNull();
    expect(screen.queryByTestId("record-account-holder")).toBeNull();
    expect(screen.queryByTestId("record-invoicing-name")).toBeNull();
    expect(screen.queryByTestId("record-vat-number")).toBeNull();
  });

  it("still asks a buyer for its branches and its numbers", async () => {
    const user = userEvent.setup();
    renderRecord({ isSupplier: false, billing: null, met: 1, total: 2 });

    await edit(user);
    expect(screen.getByTestId("record-add-branch")).toBeInTheDocument();
    expect(screen.getByTestId("record-add-contact")).toBeInTheDocument();
  });
});

describe("a branch's position is a pin on a map, never a typed number", () => {
  it("offers a BUTTON, not a link field", async () => {
    const user = userEvent.setup();
    renderRecord();
    await edit(user);

    expect(screen.queryByTestId("branch-map")).toBeNull();
    expect(screen.getByTestId("record-pick-location")).toHaveTextContent(
      RECORD_LABELS.addPosition,
    );
    expect(screen.getByTestId("record-position-empty")).toHaveTextContent(
      RECORD_LABELS.positionEmpty,
    );
  });

  it("will not save a NEW branch until the pin is confirmed", async () => {
    const user = userEvent.setup();
    renderRecord();
    await edit(user);
    await fillMainBranch(user);

    // Everything else is answered. The position is not.
    expect(screen.getByTestId("record-save")).toBeDisabled();

    await placePin(user);
    await waitFor(() => expect(screen.getByTestId("record-save")).toBeEnabled());
  });

  it("OPENING the map is not confirming it", async () => {
    const user = userEvent.setup();
    renderRecord();
    await edit(user);
    await user.click(screen.getByTestId("record-pick-location"));
    moveMarker?.(24.5, 46.5);
    await user.click(screen.getByTestId("picker-cancel"));

    expect(screen.getByTestId("record-position-empty")).toBeInTheDocument();
  });

  it("sends the confirmed pair, and never a link", async () => {
    const user = userEvent.setup();
    renderRecord();
    await edit(user);
    await fillMainBranch(user);
    await placePin(user, null, 24.774265, 46.738586);

    await user.click(screen.getByTestId("record-save"));
    await waitFor(() => expect(post).toHaveBeenCalled());

    const call = post.mock.calls.find(
      ([path]) => path === "/companies/me/locations",
    ) as [string, Record<string, unknown>];
    expect(call).toBeTruthy();
    expect(call[1].regionId).toBe(REGION_ID);
    expect(call[1].latitude).toBe(24.774265);
    expect(call[1].longitude).toBe(46.738586);
    expect(call[1]).not.toHaveProperty("mapUrl");
  });

  it("saves a branch on a region alone, with no city", async () => {
    const user = userEvent.setup();
    renderRecord();
    await edit(user);
    await fillMainBranch(user);
    await placePin(user);
    await user.click(screen.getByTestId("record-save"));

    await waitFor(() => expect(post).toHaveBeenCalled());
    const call = post.mock.calls.find(
      ([path]) => path === "/companies/me/locations",
    ) as [string, Record<string, unknown>];
    expect(call[1].regionId).toBe(REGION_ID);
    // Null, not absent: on an edit an absent field means "leave it
    // alone" and null means "clear it", and those differ.
    expect(call[1].cityId).toBeNull();
  });

  it("offers no city picker until a region is chosen", async () => {
    const user = userEvent.setup();
    renderRecord();
    await edit(user);

    // The MAIN branch's place is on the grid: no region, no city list.
    expect(screen.getByTestId("record-city-needs-region")).toBeInTheDocument();
    await pickGridRegion(user, REGIONS[0].name);
    expect(screen.getByTestId("record-city")).toBeInTheDocument();
  });

  /**
   * AN EDIT THAT NEVER OPENED THE MAP MUST NOT MOVE THE BRANCH.
   * Omission is "leave it alone" for every other field, and the
   * position is no different.
   */
  it("sends no coordinates when an edit does not touch the map", async () => {
    const user = userEvent.setup();
    renderRecord({ branches: [SAVED_BRANCH] });
    await edit(user);

    await user.clear(screen.getByTestId("record-short-address"));
    await user.type(screen.getByTestId("record-short-address"), "RRRD3030");
    await user.click(screen.getByTestId("record-save"));

    await waitFor(() => expect(patch).toHaveBeenCalled());
    const call = patch.mock.calls.find(([path]) =>
      String(path).startsWith("/companies/me/locations/"),
    ) as [string, Record<string, unknown>];
    expect(call[1].shortAddress).toBe("RRRD3030");
    expect(call[1]).not.toHaveProperty("latitude");
    expect(call[1]).not.toHaveProperty("longitude");
  });

  it("an edit CAN move the branch, and then it sends the new pair", async () => {
    const user = userEvent.setup();
    renderRecord({ branches: [SAVED_BRANCH] });
    await edit(user);

    expect(screen.getByTestId("record-pick-location")).toHaveTextContent(
      RECORD_LABELS.changePosition,
    );
    await placePin(user, null, 21.422487, 39.826206);
    await user.click(screen.getByTestId("record-save"));

    await waitFor(() => expect(patch).toHaveBeenCalled());
    const call = patch.mock.calls.find(([path]) =>
      String(path).startsWith("/companies/me/locations/"),
    ) as [string, Record<string, unknown>];
    expect(call[1].latitude).toBe(21.422487);
    expect(call[1].longitude).toBe(39.826206);
  });

  it("writes NOTHING for a branch nobody touched", async () => {
    const user = userEvent.setup();
    renderRecord({ branches: [SAVED_BRANCH] });
    await edit(user);
    await user.click(screen.getByTestId("record-save"));

    await waitFor(() => expect(screen.getByTestId("record-edit")).toBeTruthy());
    expect(patch).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it("parses no map link of its own — there is no link to parse", () => {
    const source = strip(read("components/company/company-record-card.tsx"));

    expect(source).not.toContain('from "@/lib/map-link"');
    expect(source).not.toMatch(/!3d|goo\.gl|google\.com\/maps/);
  });

  it("needs no map vendor account: no key, no token, no account", () => {
    // «بلا خدمة مدفوعة».
    const source = strip(read("components/company/location-picker.tsx"));

    expect(source).not.toMatch(/apiKey|api_key|accessToken|access_token/i);
    expect(source).not.toMatch(/googleapis|mapbox|maps\.google/i);
  });

  it("the shared map-link reader still accepts the shortened share link", () => {
    // The ADMIN console's branch form still takes a link, and the API
    // still follows one. This pins the shared reader, not this card.
    expect(looksLikeAPlace("https://maps.app.goo.gl/abc123")).toBe(true);
    expect(
      looksLikeAPlace("https://www.google.com/maps?q=24.7136,46.6753"),
    ).toBe(true);
  });
});

describe("a contact is a name AND a number", () => {
  it("adds a row, and removes one", async () => {
    const user = userEvent.setup();
    renderRecord();
    await edit(user);

    await user.click(screen.getByTestId("record-add-contact"));
    expect(screen.getByTestId("record-contact-name-1")).toBeInTheDocument();

    await user.click(screen.getByTestId("record-remove-contact-1"));
    expect(screen.queryByTestId("record-contact-name-1")).toBeNull();
  });

  it("NEVER offers to remove the first one", async () => {
    // It is the number given at registration and the company's only
    // reachable one; removing it would leave nobody to call.
    const user = userEvent.setup();
    renderRecord();
    await edit(user);

    expect(screen.queryByTestId("record-remove-contact-0")).toBeNull();
  });

  it("will not save a half-filled row", async () => {
    const user = userEvent.setup();
    renderRecord();
    await edit(user);

    await user.click(screen.getByTestId("record-add-contact"));
    await user.type(screen.getByTestId("record-contact-name-1"), "خالد");
    // A name with no number is not a contact.
    expect(screen.getByTestId("record-save")).toBeDisabled();

    await user.type(screen.getByTestId("record-contact-phone-1"), "0555555555");
    await waitFor(() => expect(screen.getByTestId("record-save")).toBeEnabled());
  });

  it("creates the new one and leaves the untouched one alone", async () => {
    const user = userEvent.setup();
    renderRecord();
    await edit(user);

    await user.click(screen.getByTestId("record-add-contact"));
    await user.type(screen.getByTestId("record-contact-name-1"), "خالد");
    await user.type(screen.getByTestId("record-contact-phone-1"), "0555555555");
    await user.click(screen.getByTestId("record-save"));

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls).toContainEqual([
      "/companies/me/contacts",
      { name: "خالد", phone: "0555555555" },
    ]);
    expect(patch).not.toHaveBeenCalled();
  });

  it("deletes a row that was removed, and only a SAVED one", async () => {
    const user = userEvent.setup();
    renderRecord({
      contacts: [
        SAVED_CONTACT,
        { ...SAVED_CONTACT, id: "contact-2", name: "خالد", phone: "0555555555" },
      ],
    });
    await edit(user);

    await user.click(screen.getByTestId("record-remove-contact-1"));
    await user.click(screen.getByTestId("record-save"));

    await waitFor(() => expect(del).toHaveBeenCalled());
    expect(del).toHaveBeenCalledWith("/companies/me/contacts/contact-2");
    expect(del).toHaveBeenCalledTimes(1);
  });
});

describe("the bank the IBAN names", () => {
  it("offers no field for it and no list to pick from", async () => {
    const user = userEvent.setup();
    renderRecord();
    await edit(user);

    expect(screen.queryByTestId("bank-name")).toBeNull();
    expect(screen.getByTestId("record-bank")).toHaveTextContent(
      RECORD_LABELS.bankPending,
    );
  });

  it("names Al Rajhi for a bank-code-80 IBAN", async () => {
    const user = userEvent.setup();
    renderRecord();
    await edit(user);

    await user.type(
      screen.getByTestId("record-iban"),
      "SA03 8000 0000 6080 1016 7519",
    );

    expect(screen.getByTestId("record-bank")).toHaveTextContent("مصرف الراجحي");
    expect(screen.getByTestId("record-bank-auto")).toHaveTextContent(
      RECORD_LABELS.bankAutoDetected,
    );
  });

  it("names Alinma for a bank-code-05 IBAN — a different number, a different bank", async () => {
    const user = userEvent.setup();
    renderRecord();
    await edit(user);

    await user.type(
      screen.getByTestId("record-iban"),
      "SA6805000084000066666000",
    );

    expect(screen.getByTestId("record-bank")).toHaveTextContent("مصرف الإنماء");
  });

  it("refuses to save a number whose checksum does not agree", async () => {
    const user = userEvent.setup();
    renderRecord();
    await edit(user);

    // The last digit of the valid fixture changed.
    await user.type(
      screen.getByTestId("record-iban"),
      "SA0380000000608010167518",
    );

    expect(screen.getByTestId("record-save")).toBeDisabled();
  });

  it("still saves a sound number whose bank code is unknown", async () => {
    // A table that lags a new bank must not stop a supplier being paid.
    const user = userEvent.setup();
    renderRecord();
    await edit(user);

    await user.type(
      screen.getByTestId("record-iban"),
      "SA5499000000000000000000",
    );
    await user.type(screen.getByTestId("record-account-holder"), "شركة الاختبار");

    expect(screen.getByTestId("record-bank")).toHaveTextContent(
      RECORD_LABELS.bankNotIdentified,
    );
    await waitFor(() => expect(screen.getByTestId("record-save")).toBeEnabled());
  });

  it("sends the IBAN and NOT the bank", async () => {
    const user = userEvent.setup();
    renderRecord();
    await edit(user);

    await user.type(
      screen.getByTestId("record-iban"),
      "SA03 8000 0000 6080 1016 7519",
    );
    await user.type(screen.getByTestId("record-account-holder"), "شركة الاختبار");
    await user.click(screen.getByTestId("record-save"));

    await waitFor(() => expect(post).toHaveBeenCalled());
    const call = post.mock.calls.find(
      ([path]) => path === "/companies/me/bank-account",
    ) as [string, Record<string, unknown>];
    expect(call[1].iban).toBe("SA0380000000608010167519");
    // The server reads the bank out of the number itself.
    expect(call[1]).not.toHaveProperty("bankName");
  });

  it("sends NO bank account when the IBAN field was left alone", async () => {
    // The account on file is what an administrator approved; an edit
    // that touches something else must not append a second one.
    const user = userEvent.setup();
    renderRecord({
      bank: {
        accountHolderName: "شركة الاختبار",
        bankName: "مصرف الراجحي",
        ibanLast4: "7519",
      },
    });
    await edit(user);

    await user.clear(screen.getByTestId("record-vat-number"));
    await user.type(screen.getByTestId("record-vat-number"), "300000000000003");
    await user.click(screen.getByTestId("record-save"));

    await waitFor(() => expect(put).toHaveBeenCalled());
    expect(
      post.mock.calls.filter(([p]) => p === "/companies/me/bank-account"),
    ).toHaveLength(0);
  });

  it("shows only the last four of an account it already has", () => {
    renderRecord({
      bank: {
        accountHolderName: "شركة الاختبار",
        bankName: "مصرف الراجحي",
        ibanLast4: "7519",
      },
    });

    expect(screen.getByTestId("record-iban")).toHaveTextContent("7519");
    expect(screen.getByTestId("record-iban")).not.toHaveTextContent("SA03");
  });
});

describe("the VAT number is required, and it is typed", () => {
  /**
   * THE «مسجّلة / غير مسجّلة» QUESTION IS GONE, by the owner's rule: a
   * supplier on this platform HAS a registration, so the form asks for
   * the number and offers no other answer.
   */
  it("offers no yes/no question at all", async () => {
    const user = userEvent.setup();
    renderRecord();
    await edit(user);

    expect(screen.queryByTestId("record-vat-yes")).toBeNull();
    expect(screen.queryByTestId("record-vat-no")).toBeNull();
    expect(screen.getByTestId("record-vat-number")).toBeInTheDocument();
  });

  it("will not save while it is empty", async () => {
    const user = userEvent.setup();
    renderRecord({
      billing: {
        invoicingLegalName: "مؤسسة الإمداد",
        isVatRegistered: null,
        vatNumber: null,
      },
    });
    await edit(user);

    expect(screen.getByTestId("record-save")).toBeDisabled();

    await user.type(screen.getByTestId("record-vat-number"), "310123456700003");
    await waitFor(() => expect(screen.getByTestId("record-save")).toBeEnabled());
  });

  it("refuses a number that is not fifteen digits, beside the field", async () => {
    const user = userEvent.setup();
    renderRecord();
    await edit(user);

    await user.clear(screen.getByTestId("record-vat-number"));
    await user.type(screen.getByTestId("record-vat-number"), "31012345670000");

    expect(screen.getByText(RECORD_LABELS.vatNumberInvalid)).toBeInTheDocument();
    expect(screen.getByTestId("record-save")).toBeDisabled();
  });

  it("stops at fifteen digits — a sixteenth cannot be typed", async () => {
    const user = userEvent.setup();
    renderRecord();
    await edit(user);

    await user.clear(screen.getByTestId("record-vat-number"));
    await user.type(
      screen.getByTestId("record-vat-number"),
      "3101234567000034",
    );

    expect(screen.getByTestId("record-vat-number")).toHaveValue(
      "310123456700003",
    );
  });

  it("always sends «registered», with the number", async () => {
    const user = userEvent.setup();
    renderRecord({
      billing: {
        invoicingLegalName: "مؤسسة الإمداد",
        isVatRegistered: null,
        vatNumber: null,
      },
    });
    await edit(user);

    await user.type(screen.getByTestId("record-vat-number"), "310123456700003");
    await user.click(screen.getByTestId("record-save"));

    await waitFor(() => expect(put).toHaveBeenCalled());
    const call = put.mock.calls.find(
      ([path]) => path === "/companies/me/tax-profile",
    ) as [string, Record<string, unknown>];
    expect(call[1]).toEqual({
      isVatRegistered: true,
      vatNumber: "310123456700003",
    });
  });

  it("reads an older «غير مسجّلة» record back as the answer it was", () => {
    // The API still accepts that answer, so a record entered before
    // this rule has to keep reading back correctly.
    renderRecord({
      billing: {
        invoicingLegalName: "مؤسسة",
        isVatRegistered: false,
        vatNumber: null,
      },
    });

    expect(screen.getByTestId("record-vat-number")).toHaveTextContent(
      RECORD_LABELS.vatNotRegistered,
    );
  });
});

describe("one press, only what changed", () => {
  /**
   * THE BILLING NAME IS THE LEGAL NAME, filled in on save rather than
   * asked for. There is no field, and there is no hidden field either:
   * it is derived, it never blocks a save, and it counts towards
   * completion the moment it is written.
   */
  it("offers no billing-name field at all", async () => {
    const user = userEvent.setup();
    renderRecord();
    await edit(user);

    expect(screen.queryByTestId("record-invoicing-name")).toBeNull();
    expect(screen.queryByLabelText(/الفوترة/)).toBeNull();
  });

  it("writes the LEGAL name as the billing name when it is not yet stored", async () => {
    const user = userEvent.setup();
    renderRecord({
      billing: {
        invoicingLegalName: null,
        isVatRegistered: true,
        vatNumber: "310123456700003",
      },
    });
    await edit(user);

    // Nothing else touched: the save is offered, and it fills the name.
    await waitFor(() => expect(screen.getByTestId("record-save")).toBeEnabled());
    await user.click(screen.getByTestId("record-save"));

    await waitFor(() => expect(put).toHaveBeenCalled());
    expect(put.mock.calls[0]).toEqual([
      "/companies/me/invoicing-profile",
      { invoicingLegalName: "مؤسسة الاختبار" },
    ]);
  });

  it("does NOT block the save while it is unstored", async () => {
    // The commonest invisible reason a save used to be refused.
    const user = userEvent.setup();
    renderRecord({
      billing: {
        invoicingLegalName: null,
        isVatRegistered: true,
        vatNumber: "310123456700003",
      },
    });
    await edit(user);

    expect(screen.queryByTestId("record-blockers")).toBeNull();
    expect(screen.getByTestId("record-save")).toBeEnabled();
  });

  it("writes the VAT answer on its own when only that changed", async () => {
    const user = userEvent.setup();
    renderRecord();
    await edit(user);

    await user.clear(screen.getByTestId("record-vat-number"));
    await user.type(screen.getByTestId("record-vat-number"), "300000000000003");
    await user.click(screen.getByTestId("record-save"));

    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0]).toEqual([
      "/companies/me/tax-profile",
      { isVatRegistered: true, vatNumber: "300000000000003" },
    ]);
  });

  it("writes NOTHING when nothing changed", async () => {
    const user = userEvent.setup();
    renderRecord({ branches: [SAVED_BRANCH] });
    await edit(user);
    await user.click(screen.getByTestId("record-save"));

    await waitFor(() => expect(screen.getByTestId("record-edit")).toBeTruthy());
    expect(put).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it("keeps the card open, with the refusal on it, when a save fails", async () => {
    const user = userEvent.setup();
    put.mockRejectedValueOnce(new Error("nope"));
    renderRecord();
    await edit(user);

    await user.clear(screen.getByTestId("record-vat-number"));
    await user.type(screen.getByTestId("record-vat-number"), "300000000000003");
    await user.click(screen.getByTestId("record-save"));

    await waitFor(() =>
      expect(screen.getByTestId("record-error")).toBeInTheDocument(),
    );
    // Still editing: closing the card would lose everything else typed.
    expect(screen.getByTestId("record-save")).toBeInTheDocument();
  });
});

describe("the send, at the foot of the one card", () => {
  it("offers nothing while the server says the record is not ready", () => {
    renderRecord({ canSubmit: false });

    expect(screen.queryByTestId("record-submit")).toBeNull();
  });

  it("offers the button once the server says nothing is missing", () => {
    renderRecord({ canSubmit: true, met: 4, total: 4 });

    expect(screen.getByTestId("record-submit")).toBeInTheDocument();
  });

  it("sends the request and re-reads the state rather than guessing it", async () => {
    const user = userEvent.setup();
    renderRecord({ canSubmit: true, met: 4, total: 4 });

    await user.click(screen.getByTestId("record-submit"));

    await waitFor(() => {
      expect(post).toHaveBeenCalledWith("/companies/me/verification-request");
      expect(refresh).toHaveBeenCalled();
    });
  });

  it("hides the send while the card is being edited", async () => {
    // Sending a record somebody is halfway through changing would
    // submit whatever happened to be saved, not what is on screen.
    const user = userEvent.setup();
    renderRecord({ canSubmit: true, met: 4, total: 4 });
    await edit(user);

    expect(screen.queryByTestId("record-submit")).toBeNull();
  });

  it("offers NO «حفظ كمسودة» — there is no draft behind one", () => {
    renderRecord({ canSubmit: true, met: 4, total: 4 });

    expect(screen.queryByText(/مسودة/)).toBeNull();
  });
});

describe("both languages", () => {
  it("carries every «بيانات المنشأة» string in English too", () => {
    const flatten = (value: unknown, prefix = ""): string[] =>
      typeof value === "object" && value !== null
        ? Object.entries(value).flatMap(([key, inner]) =>
            flatten(inner, prefix ? `${prefix}.${key}` : key),
          )
        : [prefix];

    expect(flatten(messages.company).sort()).toEqual(
      flatten(en.company).sort(),
    );
  });

  it("shows a reader no raw message key", () => {
    // Every string rendered by these cards is resolved on the server and
    // handed down; a key would arrive here only if the catalogue were
    // missing it.
    for (const catalogue of [messages, en]) {
      const serialised = JSON.stringify(
        (catalogue as Record<string, unknown>).company,
      );
      expect(serialised).not.toMatch(/company\.[a-z]+\.[a-z]+/i);
    }
  });
});

// ================ THE SIX FIXES THIS BATCH CARRIES ===================

describe("the city list is read live, not from a five-minute cache", () => {
  /**
   * THE FAULT. `/cities/active` was read on the SERVER through a
   * 300-second Next.js data cache, so an administrator switching a
   * city on changed nothing here for up to five minutes — and the only
   * thing that ever looked like it helped was changing the region and
   * changing it back, which merely re-derived the list from props that
   * were already stale. Re-rendering the page would have re-read it
   * and thrown away everything typed.
   */
  it("asks the API for the list itself, on mount", async () => {
    renderRecord();

    await waitFor(() => expect(get).toHaveBeenCalledWith("/cities/active"));
  });

  it("reads it with NO cache — a cached read would be the fault again", async () => {
    renderRecord();

    await waitFor(() => expect(get).toHaveBeenCalled());
    const [, options] = get.mock.calls[0] as [string, unknown];
    // `apiClient` defaults to no-store; what must never appear here is
    // an opt-in revalidate window.
    expect(options).toBeUndefined();
  });

  it("shows what the LIVE read returned, not what the server handed down", async () => {
    const user = userEvent.setup();
    // The server's list is empty; the live read has one city.
    renderRecord({ cities: [] });
    await edit(user);
    await pickGridRegion(user, REGIONS[0].name);

    await user.click(screen.getByTestId("record-city"));
    expect(await screen.findByRole("option", { name: /الرياض/ })).toBeTruthy();
  });

  it("does not re-render the page to refresh it", () => {
    // `router.refresh()` re-reads on the server and rebuilds the form,
    // which is exactly how the typed input was lost.
    const source = strip(read("components/company/use-live-cities.ts"));

    expect(source).not.toContain("useRouter");
    expect(source).not.toContain("revalidate");
  });
});

describe("a refused save says why, and keeps what was typed", () => {
  it("names every reason under the button", async () => {
    const user = userEvent.setup();
    renderRecord({
      billing: {
        invoicingLegalName: null,
        isVatRegistered: null,
        vatNumber: null,
      },
    });
    await edit(user);

    const reasons = screen.getByTestId("record-blockers");
    expect(reasons).toHaveTextContent(RECORD_LABELS.blockVatMissing);
    // THE BILLING NAME IS NEVER A REASON. It is derived from the legal
    // name on save, so it cannot be the invisible thing holding a save
    // back — which is exactly what it used to be.
    expect(reasons.textContent).not.toContain("الفوترة");
    expect(screen.getByTestId("record-save")).toBeDisabled();
  });

  it("drops each reason as it is answered", async () => {
    const user = userEvent.setup();
    renderRecord({
      billing: {
        invoicingLegalName: null,
        isVatRegistered: null,
        vatNumber: null,
      },
    });
    await edit(user);

    await user.type(screen.getByTestId("record-vat-number"), "310123456700003");
    await waitFor(() =>
      expect(screen.queryByTestId("record-blockers")).toBeNull(),
    );
    expect(screen.getByTestId("record-save")).toBeEnabled();
  });

  it("keeps every field a refused REQUEST was carrying", async () => {
    const user = userEvent.setup();
    put.mockRejectedValueOnce(new Error("nope"));
    renderRecord();
    await edit(user);

    await user.clear(screen.getByTestId("record-email"));
    await user.type(screen.getByTestId("record-email"), "new@example.com");
    await user.clear(screen.getByTestId("record-vat-number"));
    await user.type(screen.getByTestId("record-vat-number"), "300000000000003");
    await user.click(screen.getByTestId("record-save"));

    await waitFor(() =>
      expect(screen.getByTestId("record-error")).toBeInTheDocument(),
    );
    // Nothing was reset, and the card is still open on it.
    expect(screen.getByTestId("record-email")).toHaveValue("new@example.com");
    expect(screen.getByTestId("record-vat-number")).toHaveValue(
      "300000000000003",
    );
    expect(screen.getByTestId("record-save")).toBeInTheDocument();
  });
});

describe("the main branch is written for the company", () => {
  it("asks for no branch name and no branch telephone", async () => {
    const user = userEvent.setup();
    renderRecord();
    await edit(user);

    expect(screen.queryByTestId("record-branch-name-0")).toBeNull();
    expect(screen.queryByTestId("record-branch-phone-0")).toBeNull();
  });

  it("names it «الفرع الرئيسي» and takes the contact from the company's own", async () => {
    const user = userEvent.setup();
    renderRecord();
    await edit(user);
    await fillMainBranch(user);
    await placePin(user);
    await user.click(screen.getByTestId("record-save"));

    await waitFor(() => expect(post).toHaveBeenCalled());
    const call = post.mock.calls.find(
      ([path]) => path === "/companies/me/locations",
    ) as [string, Record<string, unknown>];
    expect(call[1].name).toBe(RECORD_LABELS.mainBranch);
    expect(call[1].contactName).toBe(SAVED_CONTACT.name);
    expect(call[1].contactPhone).toBe(SAVED_CONTACT.phone);
  });

  it("UPDATES the one it has rather than adding a second", async () => {
    const user = userEvent.setup();
    renderRecord({ branches: [SAVED_BRANCH] });
    await edit(user);

    await user.clear(screen.getByTestId("record-short-address"));
    await user.type(screen.getByTestId("record-short-address"), "RRRD3030");
    await user.click(screen.getByTestId("record-save"));

    await waitFor(() => expect(patch).toHaveBeenCalled());
    expect(patch).toHaveBeenCalledTimes(1);
    expect(
      post.mock.calls.filter(([p]) => p === "/companies/me/locations"),
    ).toHaveLength(0);
  });

  it("does NOT rename a branch it already has", async () => {
    // The card does not ask for the name, so it must not rewrite it.
    const user = userEvent.setup();
    renderRecord({ branches: [{ ...SAVED_BRANCH, name: "مستودع الشمال" }] });
    await edit(user);

    await user.clear(screen.getByTestId("record-short-address"));
    await user.type(screen.getByTestId("record-short-address"), "RRRD3030");
    await user.click(screen.getByTestId("record-save"));

    await waitFor(() => expect(patch).toHaveBeenCalled());
    const call = patch.mock.calls[0] as [string, Record<string, unknown>];
    expect(call[1].name).toBe("مستودع الشمال");
  });

  it("keeps «إضافة فرع» for the OPTIONAL branches only", async () => {
    const user = userEvent.setup();
    renderRecord({ branches: [SAVED_BRANCH] });
    await edit(user);

    // The main branch is the grid above; the list below is empty.
    expect(screen.getByTestId("record-branches-empty")).toHaveTextContent(
      RECORD_LABELS.extraBranchesEmpty,
    );

    await user.click(screen.getByTestId("record-add-branch"));
    // The new row is the SECOND branch, and it asks for everything.
    expect(screen.getByTestId("record-branch-name-1")).toBeInTheDocument();
    expect(screen.getByTestId("record-branch-region-1")).toBeInTheDocument();
  });
});

describe("the region is required and the city is not", () => {
  it("blocks the save without a region", async () => {
    const user = userEvent.setup();
    renderRecord();
    await edit(user);

    await user.type(screen.getByTestId("record-short-address"), "RRRD2929");
    await placePin(user);

    expect(screen.getByTestId("record-blockers")).toHaveTextContent(
      RECORD_LABELS.blockRegion,
    );
    expect(screen.getByTestId("record-save")).toBeDisabled();
  });

  it("saves with a region and NO city", async () => {
    const user = userEvent.setup();
    renderRecord();
    await edit(user);
    await fillMainBranch(user);
    await placePin(user);

    // Never listed as a reason, and never in the way.
    expect(screen.queryByTestId("record-blockers")).toBeNull();
    await user.click(screen.getByTestId("record-save"));

    await waitFor(() => expect(post).toHaveBeenCalled());
    const call = post.mock.calls.find(
      ([path]) => path === "/companies/me/locations",
    ) as [string, Record<string, unknown>];
    expect(call[1].cityId).toBeNull();
  });
});

describe("Google Maps, and what it needs", () => {
  it("is what the picker mounts once a key is configured", () => {
    const source = strip(read("components/company/location-picker.tsx"));

    expect(source).toContain("hasGoogleMapsKey");
    expect(source).toContain("<GoogleLocationPicker");
  });

  it("says plainly when the key is missing rather than showing a dead box", () => {
    const source = strip(read("components/company/location-picker.tsx"));

    expect(source).toContain("picker-no-google-key");
    expect(source).toContain("usingOpenStreetMap");
  });

  it("carries search, wheel zoom, my-location and a draggable pin", () => {
    const source = strip(read("components/company/google-location-picker.tsx"));

    expect(source).toContain("picker-search");
    // Google's default demands ctrl+wheel on a scrolling page.
    expect(source).toContain("gestureHandling");
    expect(source).toContain("greedy");
    expect(source).toContain("navigator.geolocation.getCurrentPosition");
    expect(source).toContain("draggable: true");
    expect(source).toContain("picker-confirm");
  });

  it("reads the key from the environment and never from the repository", () => {
    const loader = strip(read("lib/google-maps.ts"));

    expect(loader).toContain("process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY");
    // A key committed here would be a key on the owner's bill, in git.
    expect(loader).not.toMatch(/AIza[0-9A-Za-z_-]{10}/);
  });

  it("needs no Places API — the search box uses the Geocoder", () => {
    // One fewer API for the operator to enable, and none of the
    // Places-widget deprecations to track.
    const source = strip(read("components/company/google-location-picker.tsx"));

    expect(source).toContain("Geocoder");
    expect(source).not.toContain("places.Autocomplete");
    expect(source).not.toContain("PlaceAutocompleteElement");
  });
});

describe("the registration number, and where the owner moved it", () => {
  it("lives in the table below, not in the strip above", () => {
    // «نزّل رقم السجل التجاري الجدول في البطاقة اللي تحت عشان يعطي
    //  مجال للاسم، لأن الاسم يظهر نصفه فقط.»
    //
    // The strip is ONE line and the company's name is what it is for.
    // The number's label, its digits and its lock came to about a
    // hundred and seventy pixels of a phone's width, and the name was
    // truncated to half of itself to pay for them.
    renderRecord();

    expect(screen.getByTestId("record-cr-number")).toHaveTextContent("1010101010");
    expect(screen.queryByTestId("identity-cr-number")).toBeNull();

    // AND IT IS NOT IN BOTH PLACES. One number, one row.
    const band = screen.getByTestId("company-identity-band");
    expect(band.textContent).not.toContain("1010101010");
  });

  it("offers no way to change it, in either state", async () => {
    // It is verified at registration and locked, so the table shows it
    // and never opens a field for it — not even while the rest of the
    // card is being edited.
    const user = userEvent.setup();
    renderRecord();

    expect(screen.getByTestId("record-cr-number").tagName).not.toBe("INPUT");
    await edit(user);
    expect(screen.getByTestId("record-cr-number").tagName).not.toBe("INPUT");
  });

  it("still says the number is locked, for a reader who cannot see the lock", () => {
    renderRecord();

    expect(screen.getByText(RECORD_LABELS.lockedNotice)).toHaveClass("sr-only");
  });
  it("folds the tick into the state chip, beside the name", () => {
    // It used to float at the end of the band on a column of its own,
    // held level with the box by an invisible copy of the label. The
    // approved image puts a shield inside the chip instead — one mark,
    // beside the thing it qualifies, and a line of height back.
    renderRecord();

    const chip = screen.getByTestId("identity-status");
    expect(chip.querySelector("svg")).not.toBeNull();

    const source = strip(read("components/company/company-record-card.tsx"));
    expect(source).not.toContain("CheckCircle2");
  });

  it("stands the name and its state on ONE line", () => {
    // The band was three stacked things that are one fact between
    // them: the label, the name, and a chip about the name under it.
    renderRecord();

    const name = screen.getByTestId("identity-legal-name");
    const chip = screen.getByTestId("identity-status");
    expect(name.parentElement).toBe(chip.parentElement);
  });

  it("still says the number is locked, for a reader who cannot see the lock", () => {
    renderRecord();

    expect(screen.getByText(RECORD_LABELS.lockedNotice)).toHaveClass("sr-only");
  });

});

describe("the email is editable, and its edit is really saved", () => {
  it("is a field once the card is open, and a value before that", async () => {
    const user = userEvent.setup();
    renderRecord();

    // A read value: the testid sits on the SPAN, with the address in a
    // <bdi> inside it so a Latin address never flips a right-to-left row.
    expect(screen.getByTestId("record-email").tagName).toBe("SPAN");
    expect(screen.getByTestId("record-email").querySelector("bdi")).toBeTruthy();
    await edit(user);
    expect(screen.getByTestId("record-email").tagName).toBe("INPUT");
    expect(screen.getByTestId("record-email")).toHaveValue("owner@example.com");
  });

  it("is filled from the registration data", async () => {
    const user = userEvent.setup();
    renderRecord({ email: "registered@example.com" });
    await edit(user);

    expect(screen.getByTestId("record-email")).toHaveValue(
      "registered@example.com",
    );
  });

  it("refuses a shape that could never be an address, beside the field", async () => {
    const user = userEvent.setup();
    renderRecord();
    await edit(user);

    await user.clear(screen.getByTestId("record-email"));
    await user.type(screen.getByTestId("record-email"), "not-an-address");

    expect(screen.getByText(RECORD_LABELS.emailInvalid)).toBeInTheDocument();
    expect(screen.getByTestId("record-blockers")).toHaveTextContent(
      RECORD_LABELS.blockEmailInvalid,
    );
    expect(screen.getByTestId("record-save")).toBeDisabled();
  });

  it("will not save it empty", async () => {
    const user = userEvent.setup();
    renderRecord();
    await edit(user);

    await user.clear(screen.getByTestId("record-email"));

    expect(screen.getByTestId("record-blockers")).toHaveTextContent(
      RECORD_LABELS.blockEmailMissing,
    );
    expect(screen.getByTestId("record-save")).toBeDisabled();
  });

  it("says the new address must be confirmed again", async () => {
    // Proving control of one mailbox says nothing about another.
    const user = userEvent.setup();
    renderRecord();
    await edit(user);

    expect(screen.queryByTestId("record-email-reverify")).toBeNull();
    await user.clear(screen.getByTestId("record-email"));
    await user.type(screen.getByTestId("record-email"), "new@example.com");
    expect(screen.getByTestId("record-email-reverify")).toHaveTextContent(
      RECORD_LABELS.emailReverify,
    );
  });

  it("PUTs it to the one endpoint that owns it", async () => {
    const user = userEvent.setup();
    renderRecord();
    await edit(user);

    await user.clear(screen.getByTestId("record-email"));
    await user.type(screen.getByTestId("record-email"), "new@example.com");
    await user.click(screen.getByTestId("record-save"));

    await waitFor(() => expect(put).toHaveBeenCalled());
    expect(put.mock.calls[0]).toEqual([
      "/me/email",
      { email: "new@example.com" },
    ]);
  });

  it("sends NOTHING when it was not changed", async () => {
    const user = userEvent.setup();
    renderRecord();
    await edit(user);
    await user.click(screen.getByTestId("record-save"));

    await waitFor(() => expect(screen.getByTestId("record-edit")).toBeTruthy());
    expect(
      put.mock.calls.filter(([p]) => p === "/me/email"),
    ).toHaveLength(0);
  });

  it("ignores a change of case alone — the server stores it lower-cased", async () => {
    const user = userEvent.setup();
    renderRecord();
    await edit(user);

    await user.clear(screen.getByTestId("record-email"));
    await user.type(screen.getByTestId("record-email"), "Owner@Example.com");
    await user.click(screen.getByTestId("record-save"));

    await waitFor(() => expect(screen.getByTestId("record-edit")).toBeTruthy());
    expect(
      put.mock.calls.filter(([p]) => p === "/me/email"),
    ).toHaveLength(0);
  });

  it("sends the address BEFORE anything else, so a refusal reaches the field", async () => {
    const user = userEvent.setup();
    renderRecord();
    await edit(user);

    await user.clear(screen.getByTestId("record-email"));
    await user.type(screen.getByTestId("record-email"), "new@example.com");
    await user.clear(screen.getByTestId("record-vat-number"));
    await user.type(screen.getByTestId("record-vat-number"), "300000000000003");
    await user.click(screen.getByTestId("record-save"));

    await waitFor(() => expect(put).toHaveBeenCalledTimes(2));
    expect(put.mock.calls[0][0]).toBe("/me/email");
  });
});

describe("the two rows are in the order the owner set", () => {
  /** The document order of a set of test ids on the card. */
  function orderOf(container: HTMLElement, ids: string[]): string[] {
    const found = ids
      .map((id) => ({ id, el: container.querySelector(`[data-testid="${id}"]`) }))
      .filter((x) => x.el !== null);
    return found
      .sort((a, b) =>
        a.el!.compareDocumentPosition(b.el!) &
        Node.DOCUMENT_POSITION_FOLLOWING
          ? -1
          : 1,
      )
      .map((x) => x.id);
  }

  it("row one: email, then the short address, then the VAT number", () => {
    const { container } = renderRecord();

    expect(
      orderOf(container, [
        "record-email",
        "record-short-address",
        "record-vat-number",
      ]),
    ).toEqual(["record-email", "record-short-address", "record-vat-number"]);
  });

  it("row two: the position, then the region, then the city", async () => {
    const user = userEvent.setup();
    const { container } = renderRecord({ branches: [SAVED_BRANCH] });
    await edit(user);

    expect(
      orderOf(container, [
        "record-pick-location",
        "record-region",
        "record-city",
      ]),
    ).toEqual(["record-pick-location", "record-region", "record-city"]);
  });

  it("puts the position AFTER the VAT number, on its own row", () => {
    const { container } = renderRecord();

    expect(
      orderOf(container, ["record-vat-number", "record-position-empty"]),
    ).toEqual(["record-vat-number", "record-position-empty"]);
  });

  it("row three is untouched: holder, IBAN, bank", () => {
    const { container } = renderRecord();

    expect(
      orderOf(container, [
        "record-account-holder",
        "record-iban",
        "record-bank",
      ]),
    ).toEqual(["record-account-holder", "record-iban", "record-bank"]);
  });

  it("a BUYER sees the same first two rows, without the supplier's fields", async () => {
    const user = userEvent.setup();
    const { container } = renderRecord({
      isSupplier: false,
      billing: null,
      met: 1,
      total: 2,
    });
    await edit(user);

    expect(
      orderOf(container, [
        "record-email",
        "record-short-address",
        "record-pick-location",
        "record-region",
      ]),
    ).toEqual([
      "record-email",
      "record-short-address",
      "record-pick-location",
      "record-region",
    ]);
    expect(screen.queryByTestId("record-vat-number")).toBeNull();
    expect(screen.queryByTestId("record-iban")).toBeNull();
  });
});

describe("the IBAN and its holder are a pair", () => {
  /**
   * THE FAULT THIS FIXES, seen on a real save.
   *
   * The card offered «حفظ التغييرات» for a well-formed IBAN with the
   * holder's name left blank, then POSTed an empty name. The server
   * refuses that — `accountHolderName` is `@MinLength(1)` — so the
   * press produced a 400 and a reference number instead of a saved
   * account, and the two writes BEFORE it had already gone through.
   *
   * Half an account is now refused before the button, by name.
   */
  it("names the holder as missing when only the IBAN is typed", async () => {
    const user = userEvent.setup();
    renderRecord();
    await edit(user);

    await user.type(
      screen.getByTestId("record-iban"),
      "SA03 8000 0000 6080 1016 7519",
    );

    expect(screen.getByTestId("record-blockers")).toHaveTextContent(
      RECORD_LABELS.blockAccountHolder,
    );
    expect(screen.getByTestId("record-save")).toBeDisabled();
  });

  it("names the IBAN as missing when only the holder is typed", async () => {
    const user = userEvent.setup();
    renderRecord();
    await edit(user);

    await user.type(
      screen.getByTestId("record-account-holder"),
      "مؤسسة الاختبار",
    );

    expect(screen.getByTestId("record-blockers")).toHaveTextContent(
      RECORD_LABELS.blockIbanMissing,
    );
    expect(screen.getByTestId("record-save")).toBeDisabled();
  });

  it("is content once both are there", async () => {
    const user = userEvent.setup();
    renderRecord();
    await edit(user);

    await user.type(
      screen.getByTestId("record-iban"),
      "SA03 8000 0000 6080 1016 7519",
    );
    await user.type(
      screen.getByTestId("record-account-holder"),
      "مؤسسة الاختبار",
    );

    await waitFor(() =>
      expect(screen.queryByTestId("record-blockers")).toBeNull(),
    );
    expect(screen.getByTestId("record-save")).toBeEnabled();
  });

  it("NEVER sends an empty holder, even if the press gets through", async () => {
    // A disabled button is an affordance; Enter still submits a form.
    // The rule is stated again where the request is built.
    const source = strip(read("components/company/company-record-card.tsx"));

    expect(source).toMatch(
      /read\.state === "valid" &&\s*form\.accountHolderName\.trim\(\) !== ""/,
    );
  });

  it("leaves an account already on file alone when neither half is touched", async () => {
    // Only HALF an account is refused. A supplier editing something
    // else keeps the account an administrator already approved.
    const user = userEvent.setup();
    renderRecord({
      bank: {
        accountHolderName: "شركة الاختبار",
        bankName: "مصرف الراجحي",
        ibanLast4: "7519",
      },
    });
    await edit(user);

    expect(screen.queryByTestId("record-blockers")).toBeNull();
    await user.clear(screen.getByTestId("record-vat-number"));
    await user.type(screen.getByTestId("record-vat-number"), "300000000000003");
    await user.click(screen.getByTestId("record-save"));

    await waitFor(() => expect(put).toHaveBeenCalled());
    expect(
      post.mock.calls.filter(([p]) => p === "/companies/me/bank-account"),
    ).toHaveLength(0);
  });

  it("saves the two profiles AND the account when the pair is complete", async () => {
    const user = userEvent.setup();
    renderRecord();
    await edit(user);

    await user.clear(screen.getByTestId("record-vat-number"));
    await user.type(screen.getByTestId("record-vat-number"), "300000000000003");
    await user.type(
      screen.getByTestId("record-iban"),
      "SA03 8000 0000 6080 1016 7519",
    );
    await user.type(
      screen.getByTestId("record-account-holder"),
      "مؤسسة الاختبار",
    );
    await user.click(screen.getByTestId("record-save"));

    await waitFor(() => expect(post).toHaveBeenCalled());
    const call = post.mock.calls.find(
      ([p]) => p === "/companies/me/bank-account",
    ) as [string, Record<string, unknown>];
    expect(call[1].accountHolderName).toBe("مؤسسة الاختبار");
    expect(call[1].iban).toBe("SA0380000000608010167519");
  });
});

describe("a refusal says WHICH field, not just that something is wrong", () => {
  /**
   * THE COMPLAINT THIS ANSWERS, in the owner's words: «ليه ما يبين
   * للشخص اللي يسجل البيانات وش الناقص». A refused save showed a
   * sentence and a reference number and nothing else — on a card with a
   * dozen fields. The server DID say which one; the portal threw it
   * away, because nothing from a failure may be rendered.
   *
   * THAT RULE STANDS. What is shown is this card's OWN label, matched
   * from a closed list of field names — never a word the server wrote.
   */
  function refusalNaming(fields: string[]) {
    return new ApiError({
      kind: "validation",
      status: 400,
      code: "VALIDATION_FAILED",
      requestId: "22fcdcc0-b347-4e6f-b008-c2ec02499466",
      message: "Validation failed",
      invalidFields: fields as never,
    });
  }

  async function refusedSave(fields: string[]) {
    const user = userEvent.setup();
    put.mockRejectedValueOnce(refusalNaming(fields));
    renderRecord();
    await edit(user);

    await user.clear(screen.getByTestId("record-vat-number"));
    await user.type(screen.getByTestId("record-vat-number"), "300000000000003");
    await user.click(screen.getByTestId("record-save"));

    await waitFor(() =>
      expect(screen.getByTestId("record-error")).toBeInTheDocument(),
    );
  }

  it("prints the card's own label for each field the server named", async () => {
    await refusedSave(["accountHolderName"]);

    expect(screen.getByTestId("record-error-fields")).toHaveTextContent(
      RECORD_LABELS.fieldNames.accountHolderName!,
    );
  });

  it("names several at once", async () => {
    await refusedSave(["iban", "accountHolderName"]);

    const list = screen.getByTestId("record-error-fields");
    expect(list).toHaveTextContent(RECORD_LABELS.fieldNames.iban!);
    expect(list).toHaveTextContent(RECORD_LABELS.fieldNames.accountHolderName!);
  });

  it("keeps the reference number as well — support still needs it", async () => {
    await refusedSave(["iban"]);

    expect(screen.getByTestId("record-error")).toHaveTextContent(
      "22fcdcc0-b347-4e6f-b008-c2ec02499466",
    );
  });

  it("shows the sentence alone when the server named nothing it knows", async () => {
    // The behaviour the portal had before this existed.
    await refusedSave([]);

    expect(screen.queryByTestId("record-error-fields")).toBeNull();
  });

  it("keeps everything typed, so nothing has to be entered twice", async () => {
    await refusedSave(["accountHolderName"]);

    expect(screen.getByTestId("record-vat-number")).toHaveValue(
      "300000000000003",
    );
    expect(screen.getByTestId("record-save")).toBeInTheDocument();
  });

  it("renders NO text the server wrote", () => {
    // The reader hands over NAMES from a closed list; the card looks
    // each one up in its own dictionary. There is no path from a
    // server string to the screen.
    const card = strip(read("components/company/company-record-card.tsx"));

    expect(card).toContain("labels.fieldNames[field]");
    expect(card).not.toMatch(/failure\.(message|details)\b/);
  });
});

describe("the asterisk is a form mark, so it belongs to a form", () => {
  /**
   * Reading a finished record back with red stars beside half its
   * values says something is wanted; nothing is. The stars mark the
   * SAME fields they always did — nothing about what is required
   * changed, only when the mark is drawn.
   */
  const starsIn = (container: HTMLElement) =>
    [...container.querySelectorAll("span")].filter(
      (el) => el.textContent === "*" && el.className.includes("text-danger"),
    ).length;

  it("draws none while the record is being READ", () => {
    const { container } = renderRecord();

    expect(starsIn(container)).toBe(0);
  });

  it("draws them the moment the card becomes a form", async () => {
    const user = userEvent.setup();
    const { container } = renderRecord();
    await edit(user);

    expect(starsIn(container)).toBeGreaterThan(0);
  });

  it("takes them away again when the edit is cancelled", async () => {
    const user = userEvent.setup();
    const { container } = renderRecord();
    await edit(user);
    await user.click(screen.getByTestId("record-cancel"));

    expect(starsIn(container)).toBe(0);
  });

  it("changes NO rule about what is required", async () => {
    // The same fields still hold the save back, whether or not a star
    // is drawn beside them.
    const user = userEvent.setup();
    renderRecord({
      billing: {
        invoicingLegalName: null,
        isVatRegistered: null,
        vatNumber: null,
      },
    });
    await edit(user);

    expect(screen.getByTestId("record-blockers")).toHaveTextContent(
      RECORD_LABELS.blockVatMissing,
    );
    expect(screen.getByTestId("record-save")).toBeDisabled();
  });
});

describe("field labels carry the weight of the section headings", () => {
  it("uses the same weight as «جهة الاتصال» and «فروع إضافية»", () => {
    renderRecord();

    // The heading carries its own class; a field label's text sits in
    // an inner span, so the weight is on the row that holds it.
    const sectionHeading = screen.getByText(RECORD_LABELS.extraBranchesTitle);
    const fieldLabelRow = screen.getByText(RECORD_LABELS.email).parentElement!;

    // Both are `font-semibold`: a lighter label read as a caption
    // beside a heading on the same card.
    expect(sectionHeading.className).toContain("font-semibold");
    expect(fieldLabelRow.className).toContain("font-semibold");
  });

  it("draws «جهة الاتصال» as a card beside the branches, built the same way", () => {
    // IT WENT INTO THE TABLE AND CAME BACK OUT. «انقل جهة اتصال إضافية
    // تحته تكون موازية للمدينة» made it a cell; «جهات الاتصال اجعلها
    // بطاقة موازية لبطاقة الفروع» made it a card again — and that is
    // also what put the bank row back on one line, because a tenth cell
    // in a grid three across had pushed the account holder, the IBAN
    // and the bank name apart.
    renderRecord();

    const contactHead = screen.getByText(RECORD_LABELS.contactsTitle);
    const branchHead = screen.getByText(RECORD_LABELS.extraBranchesTitle);

    // TWO HEADINGS BUILT THE SAME WAY, in one row that splits at `lg`.
    expect(contactHead.tagName).toBe("H3");
    expect(contactHead.className).toBe(branchHead.className);
    expect(contactHead.closest("div")!.className).toBe(
      branchHead.closest("div")!.className,
    );

    const foot = contactHead.closest("div")!.parentElement!.parentElement!;
    expect(foot.className).toContain("lg:grid-cols-2");
    expect(foot).toBe(branchHead.closest("div")!.parentElement!.parentElement!);
  });

  it("keeps the bank row on one line", () => {
    // «رجّع صف الحساب البنكي موازي لبعض». The grid is three across at
    // `lg`, and the supplier's nine cells fall as three clean rows —
    // the account holder, the IBAN and the bank name being the last of
    // them. A tenth cell anywhere before them breaks that.
    renderRecord();

    const grid = screen
      .getByTestId("company-record-card")
      .querySelector("div.gap-px")!;
    // TEN NOW, AND THE TENTH IS LAST FOR THIS REASON. «رجّع صف الحساب
    //  البنكي موازي لبعض» — the bank trio sits at seven, eight and
    // nine, so a cell inserted anywhere BEFORE them pushes one onto a
    // row of its own. The registration number came down from the strip
    // and went to the end of the grid, where it changes nothing above
    // it.
    expect(grid.children).toHaveLength(10);

    // The bank row is still seven, eight and nine.
    const tail = [...grid.children].slice(6, 9).map((cell) => cell.textContent ?? "");
    expect(tail[0]).toContain(RECORD_LABELS.accountHolder);
    expect(tail[1]).toContain(RECORD_LABELS.iban);
    expect(tail[2]).toContain(RECORD_LABELS.bankName);
  });
});

describe("a branch reads as a table, not as a run-on line", () => {
  /**
   * «رتّب بطاقة الفرع، كذا جايه كأنها ملخبطة وفيها فراغ كبير — بجدول أو
   * أي شيء مناسب.»
   *
   * It was three lines of running text with the region, the city, the
   * address, a name and a number strung together by middle dots:
   * nothing was labelled, so a reader had to know the ORDER to read it,
   * and the whole thing hugged one side of a card the width of the page.
   */
  /** The main branch is index 0 and lives in the table above; the
   *  extra branches are the rows after it. */
  const MAIN = {
    id: "b-0",
    name: "الفرع الرئيسي",
    regionId: REGIONS[0].id,
    cityId: CITIES[0].id,
    shortAddress: "MAIN0001",
    contactName: "مالك",
    contactPhone: "0500000000",
    isDefault: true,
    latitude: 24.7,
    longitude: 46.7,
  };

  const BRANCH = {
    id: "b-1",
    name: "فرع الشرقية",
    regionId: REGIONS[0].id,
    cityId: CITIES[0].id,
    shortAddress: "RRRD2929",
    contactName: "الياس",
    contactPhone: "0535465476",
    isDefault: false,
    latitude: 24.774265,
    longitude: 46.738586,
  };

  it("labels every field instead of running them together", () => {
    renderRecord({ branches: [MAIN, BRANCH] });

    // THE NAME LEADS, and the rest is a labelled band under it.
    expect(screen.getByText("فرع الشرقية")).toBeInTheDocument();

    // Each value is announced by its own label — the same words the
    // table above the branches uses, so nothing is named twice over.
    const band = screen.getByText("فرع الشرقية").closest("div")!.parentElement!;
    for (const label of [
      RECORD_LABELS.region,
      RECORD_LABELS.city,
      RECORD_LABELS.shortAddress,
      RECORD_LABELS.branchContactName,
    ]) {
      expect([label, within(band).getAllByText(label).length > 0]).toEqual([label, true]);
    }

    // AND THE MIDDLE DOTS ARE GONE. They were the only thing telling a
    // reader where one field ended and the next began.
    expect(band.textContent).not.toContain("·");
  });

  it("spreads the band across the card rather than hugging one side", () => {
    renderRecord({ branches: [MAIN, BRANCH] });

    const band = screen.getByText("فرع الشرقية").closest("div")!.parentElement!
      .querySelector("dl")!;

    // One column per fact at width, so there is no dead middle — the
    // same measure the product card's own band uses.
    expect(band.className).toContain("grid-cols-2");
    expect(band.className).toContain("sm:grid-cols-3");
    expect(band.className).toContain("lg:grid-cols-5");
  });

  it("leaves no hole where a branch has no city", () => {
    // Built as a LIST first and filtered, rather than a grid of
    // conditionals: an empty cell in the middle of a band is a gap
    // nobody can explain.
    renderRecord({ branches: [MAIN, { ...BRANCH, cityId: null }] });

    const band = screen.getByText("فرع الشرقية").closest("div")!.parentElement!
      .querySelector("dl")!;
    // Region, address, contact name and number — the city simply is
    // not there, rather than being there and empty.
    expect(band.querySelectorAll("dt")).toHaveLength(4);
  });
});

describe("the region list stays inside the window", () => {
  /**
   * THE FAULT, measured rather than assumed. The list is
   * absolutely positioned; the card around it carried
   * `overflow-hidden` so that the navy band's corners would clip to
   * the card's. That clipped the LIST too — its bottom fell outside
   * the card and simply stopped being drawn. It scrolled internally
   * the whole time, which is why it read as "the scrolling stops and
   * I cannot reach the last region".
   */
  it("the card no longer clips what is inside it", () => {
    const card = read("components/company/company-record-card.tsx");

    expect(card).not.toMatch(/className="flex min-w-0 flex-col overflow-hidden/);
    // The two children that touch the corners round their own instead.
    expect(card).toContain("rounded-t-card bg-primary");
    expect(card).toContain("rounded-b-card border-t border-line");
  });

  it("measures the room it has instead of assuming a fixed height", () => {
    const select = strip(read("components/ui/searchable-select.tsx"));

    expect(select).toContain("window.innerHeight");
    expect(select).toContain("maxHeight");
    // The fixed cap that could not know where the field was is gone.
    expect(select).not.toContain("max-h-64");
  });

  it("opens upward when there is more room above", () => {
    const select = strip(read("components/ui/searchable-select.tsx"));

    expect(select).toContain("bottom-full");
    expect(select).toContain("top-full");
  });

  it("re-measures on a scroll in ANY ancestor, not just the window", () => {
    // A capturing listener is the only one that hears a scroll inside
    // a container between the field and the page.
    const select = strip(read("components/ui/searchable-select.tsx"));

    expect(select).toContain('window.addEventListener("scroll", measure, true)');
  });

  it("keeps a wheel that reaches the end from scrolling the page behind", () => {
    const select = read("components/ui/searchable-select.tsx");

    expect(select).toContain("overscroll-contain");
  });

  it("drags the list with the keyboard highlight", async () => {
    // Without this the arrows walked past the visible window and the
    // list stayed put — the same complaint from the other direction.
    const select = strip(read("components/ui/searchable-select.tsx"));

    expect(select).toContain("scrollIntoView");
    expect(select).toContain('block: "nearest"');
  });

  it("reaches the LAST region with the keyboard and takes it", async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 13 }, (_, i) => ({
      id: `region-${i}`,
      name: `منطقة ${i + 1}`,
      alternateName: `Region ${i + 1}`,
    }));
    renderRecord({ regions: many });
    await edit(user);

    await user.click(screen.getByTestId("record-region"));
    // Up from the first wraps to the last — the option furthest down.
    await user.keyboard("{ArrowUp}{Enter}");

    expect(screen.getByTestId("record-region")).toHaveValue("منطقة 13");
  });

  it("reaches the last region with the pointer too", async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 13 }, (_, i) => ({
      id: `region-${i}`,
      name: `منطقة ${i + 1}`,
      alternateName: `Region ${i + 1}`,
    }));
    renderRecord({ regions: many });
    await edit(user);

    await user.click(screen.getByTestId("record-region"));
    await user.click(await screen.findByRole("option", { name: /منطقة 13/ }));

    expect(screen.getByTestId("record-region")).toHaveValue("منطقة 13");
  });

  it("loses nothing already typed when a region is chosen", async () => {
    const user = userEvent.setup();
    renderRecord();
    await edit(user);

    await user.type(screen.getByTestId("record-short-address"), "RRRD2929");
    await pickGridRegion(user, REGIONS[0].name);

    expect(screen.getByTestId("record-short-address")).toHaveValue("RRRD2929");
  });
});
