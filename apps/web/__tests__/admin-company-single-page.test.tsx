import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { AdminCompanyDetail } from "@platform/types";
import messages from "@/messages/ar-SA.json";
import en from "@/messages/en-SA.json";
import { CompanyPanels } from "@/components/admin/company-panels";
import { CompanyActivityStrip } from "@/components/admin/company-activity-strip";

/**
 * The company page, as one page.
 *
 * The promises tested here are the ones the redesign was for: no tabs,
 * no form open until it is asked for, a second factor on exactly two
 * operations, and a removal section that asks for nothing while removal
 * is impossible.
 */

const ROOT = join(__dirname, "..");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");
const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const PANELS = strip(read("components/admin/company-panels.tsx"));
const DETAIL = strip(read("app/[locale]/admin/companies/[id]/page.tsx"));

const patch = vi.fn();
const post = vi.fn();
const del = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
}));
vi.mock("@/lib/api-client", () => ({
  apiClient: {
    patch: (...args: unknown[]) => patch(...args),
    post: (...args: unknown[]) => post(...args),
    delete: (...args: unknown[]) => del(...args),
  },
  downloadFile: vi.fn(),
  uploadFile: vi.fn(),
}));

const detail = messages.admin.companyDetail;
const list = messages.admin.companies;

const LABELS = {
  detailsTitle: detail.detailsTitle,
  legalName: list.legalName,
  crNumber: list.crNumber,
  email: detail.ownerEmail,
  phones: detail.phones,
  registeredAt: detail.registeredAt,
  operationalStatus: list.operationalStatus,
  // ONE VALUE. The page resolves which of the three it is; a panel
  // that branched on a boolean could only ever say two of them.
  operationalValue: detail.operational.NOT_ACTIVE,
  branchRegion: detail.branchRegion,
  regionPlaceholder: detail.regionPlaceholder,
  regionNoMatch: detail.regionNoMatch,
  branchCityOptional: detail.branchCityOptional,
  cityPlaceholder: detail.cityPlaceholder,
  cityNoMatch: detail.cityNoMatch,
  edit: detail.editData,
  copyEmail: list.copyEmail,
  copiedEmail: list.copiedEmail,
  copyCrNumber: list.copyCrNumber,
  copiedCrNumber: list.copiedCrNumber,
  noPhones: detail.noPhones,
  mobile1: detail.mobile1,
  mobile2: detail.mobile2,
  branchesTitle: detail.branchesTitle,
  branchName: detail.branchName,
  branchCity: detail.branchCity,
  branchAddress: detail.branchAddress,
  branchPhone: detail.branchPhone,
  branchLocation: detail.branchLocation,
  branchContact: detail.branchContact,
  openLocation: detail.openLocation,
  addBranch: detail.addBranch,
  editBranch: detail.editBranch,
  mapUrl: detail.mapUrl,
  mapUrlHint: detail.mapUrlHint,
  mapUrlRejected: detail.mapUrlRejected,
  crNumberHint: detail.crNumberHint,
  noBranches: detail.noBranches,

  auditTitle: detail.auditTitle,
  auditAt: detail.activityAt,
  auditAction: detail.activityAction,
  auditActor: detail.activityActor,
  auditDetails: detail.auditDetails,
  noAudit: detail.noAudit,
  suspendTitle: detail.suspendTitle,
  suspendReason: detail.suspendReason,
  suspend: detail.suspend,
  reactivateTitle: detail.reactivateTitle,
  reactivate: detail.reactivate,
  loginPasswordSet: detail.loginPasswordSet,
  loginPasswordPending: detail.loginPasswordPending,
  loginEmailVerified: detail.loginEmailVerified,
  loginEmailUnverified: detail.loginEmailUnverified,
  bankTitle: detail.bankTitle,
  bankState: detail.bankState,
  bankActive: detail.bankActive,
  bankPending: detail.bankPending,
  bankHolder: detail.bankHolder,
  bankName: detail.bankName,
  bankIban: detail.bankIban,
  noBankAccount: detail.noBankAccount,
  deleteTitle: detail.deleteTitle,
  confirmAction: messages.admin.actions.confirm,
  deleteReason: detail.deleteReason,
  deleteAction: detail.deleteAction,
  deleteBlocked: detail.deleteBlockedShort,
  deleteConfirmLabel: detail.deleteConfirmationLabel,
  save: detail.save,
  cancel: messages.admin.actions.cancel,
  working: messages.admin.actions.working,
  errorTitle: messages.states.errorTitle,
  requestIdLabel: messages.states.requestIdLabel,
  reasonRequired: detail.reasonHint,
};

function company(
  overrides: Partial<AdminCompanyDetail> = {},
): AdminCompanyDetail {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    crNumber: "1012345678",
    legalName: "مؤسسة الإمداد التجريبية",
    accountType: "SUPPLIER",
    verificationStatus: "VERIFIED",
    createdAt: "2026-08-23T00:00:00.000Z",
    updatedAt: "2026-08-23T00:00:00.000Z",
    ownerEmail: "info@emdad-example.com",
    phones: [
      {
        value: "+966 55 123 4567",
        source: "OWNER_PRIMARY",
        contactId: null,
        label: null,
      },
      {
        value: "+966 11 234 5678",
        source: "CONTACT",
        contactId: "c1",
        label: "المبيعات",
      },
    ],
    users: [
      {
        id: "u1",
        email: "info@emdad-example.com",
        role: "OWNER",
        status: "ACTIVE",
        emailVerificationStatus: "VERIFIED",
        hasPassword: true,
        suspendedByCompany: false,
        primaryMobile1: "+966 55 123 4567",
        primaryMobile2: "+966 55 765 4321",
        createdAt: "2026-08-23T00:00:00.000Z",
      },
    ],
    contacts: [],
    locations: [
      {
        id: "b1",
        name: "فرع الرياض",
        shortAddress: "RRRD2929",
        regionId: "region-1",
        regionName: "منطقة الرياض",
        cityId: "city-1",
        cityName: "الرياض",
        contactName: "سالم",
        contactPhone: "+966 11 234 5678",
        isDefault: true,
        mapUrl: "https://www.google.com/maps?q=24.774265,46.738586",
      },
    ],
    counts: {
      products: 3,
      opportunities: 7,
      ordersAsTrader: 24,
      ordersAsSupplier: 24,
      bankAccounts: 0,
      productReports: 0,
      checkoutSessions: 0,
      policyAcceptances: 1,
      disputes: 0,
    },
    totals: { purchases: "128475.00", supplierPayable: "0.00" },
    // THE PAYOUT ACCOUNT, on the record where the verification is
    // decided — «الحسابات البنكية… المفروض إنها في بيانات المورّد».
    bankAccounts: {
      active: {
        id: "bank-1",
        accountHolderName: "مؤسسة الإمداد التجريبية",
        bankName: "مصرف الراجحي",
        ibanLast4: "4321",
        verificationStatus: "VERIFIED",
        rejectionReason: null,
        verifiedAt: "2026-08-24T00:00:00.000Z",
        createdAt: "2026-08-23T00:00:00.000Z",
      },
      pending: null,
    },
    recentActivity: [],
    ...overrides,
  } as AdminCompanyDetail;
}

function renderPage(
  overrides: Partial<AdminCompanyDetail> = {},
  eligibilityAllowed = false,
) {
  return render(
    <NextIntlClientProvider locale="ar-SA" messages={messages}>
      <CompanyPanels
        company={company(overrides)}
        registeredAtLabel="23 أغسطس 2026"
        auditExport={<button type="button">تصدير إلى Excel</button>}
        eligibility={
          eligibilityAllowed
            ? { allowed: true, blockers: [] }
            : { allowed: false, blockers: [{ kind: "LIVE_ORDERS", count: 24 }] }
        }
        blockerNames={{ LIVE_ORDERS: "طلبات جارية" }}
        regions={[
          {
            id: "region-1",
            name: "منطقة الرياض",
            alternateName: "Riyadh Region",
          },
        ]}
        cities={[
          {
            id: "city-1",
            regionId: "region-1",
            name: "الرياض",
            group: "منطقة الرياض",
            alternateName: "Riyadh",
          },
        ]}
        accountActions={<button type="button">إرسال رابط إعادة التعيين</button>}
        audit={[]}
        labels={LABELS}
      />
    </NextIntlClientProvider>,
  );
}

/** The activity gauge, with the four readings the page hands it. */
function renderStrip() {
  return render(
    <NextIntlClientProvider locale="ar-SA" messages={messages}>
      <CompanyActivityStrip
        readings={[
          {
            key: "orders",
            tone: "secondary" as const,
            label: list.orderCount,
            value: "24",
          },
          {
            key: "purchases",
            tone: "accent" as const,
            label: detail.totalPurchases,
            value: "128,475.00 ر.س",
          },
          {
            key: "opportunities",
            tone: "primary" as const,
            label: list.opportunityCount,
            value: "7",
          },
          {
            key: "disputes",
            tone: "danger" as const,
            label: detail.disputes,
            value: "0",
          },
        ]}
      />
    </NextIntlClientProvider>,
  );
}

/**
 * Pick a city the way an operator does.
 *
 * The field is a combobox now, not a <select>: with every governorate
 * in the Kingdom on the list, typing is the only usable way in.
 */
/** The last row of the branches table — the one «إضافة فرع» appended. */
const lastRow = (testId: string) =>
  screen.getAllByTestId(testId).at(-1) as HTMLElement;

async function pickRegion(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(lastRow("branch-region"));
  await user.type(lastRow("branch-region"), name);
  await user.click(await screen.findByRole("option", { name: new RegExp(name) }));
}

/**
 * THE REGION FIRST. The city picker does not exist until one is
 * chosen, so every caller picks a region and then, optionally, a city
 * beneath it.
 */
async function pickCity(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(lastRow("branch-city"));
  await user.type(lastRow("branch-city"), name);
  await user.click(await screen.findByRole("option", { name: new RegExp(name) }));
}

describe("one page, no tabs", () => {
  beforeEach(() => {
    patch.mockReset().mockResolvedValue({});
    post.mockReset().mockResolvedValue({});
    del.mockReset().mockResolvedValue({});
    refresh.mockReset();
  });

  it("shows every section on one screen, inside ONE card", () => {
    // «حط المعلومات فيها كلها في بطاقة وحدة مضغوطة» — five bordered
    // boxes became one frame with hairlines between the blocks. Each
    // block is still findable by the name it always had; what went is
    // the border, the shadow and the padding around each of them.
    renderPage();

    expect(screen.getByTestId("card-company-record")).toBeInTheDocument();

    for (const testId of [
      "card-company-details",
      "card-branches",
      "card-company-bank",
      "card-company-stop",
      "card-audit",
    ]) {
      expect(
        screen.getByTestId("card-company-record").contains(
          screen.getByTestId(testId),
        ) ||
          // The audit trail keeps its own card: it is the one section
          // that GROWS without limit, and inside the record it would
          // push the controls further down with every recorded action.
          testId === "card-audit",
      ).toBe(true);
    }
  });

  it("no longer draws the counts, which moved to the strip at the top", () => {
    // «ملخّص النشاط… يكون بعد الشريط اللي فيه اسم المورّد أو المشتري»
    // — it is the page's now, not the record card's.
    expect(PANELS).not.toContain("metric-orders");
    expect(DETAIL).toContain("CompanyActivityStrip");
  });

  it("has no users table, because a company has one owner", () => {
    // «حتى حساب الدخول لا أحتاجه وبياناته لأنه مكرّر: الإيميل،
    //  والدخول أصلًا عن طريق رقم السجل» — and the arithmetic holds:
    //  USER_COMPANY_ROLES has one role, so the table was always one
    //  row repeating an address the record already carries.
    expect(PANELS).not.toContain("labels.userEmail");
    expect(PANELS).not.toContain("CompanyUserActions");
    expect(DETAIL).not.toContain("CompanyUsersCard");

    // WHAT SURVIVED IT: two actions, in the band, and three facts
    // beside the address they are about.
    expect(DETAIL).toContain("resetPassword");
    expect(DETAIL).toContain("revokeSessions");
    expect(PANELS).toContain("company-login-marks");
  });

  it("has no separate contacts card", () => {
    // Every number lives in the one contact field of the company card.
    expect(PANELS).not.toContain("contactsTitle");
    expect(
      screen.queryByText(messages.admin.companyDetail.contacts ?? "__none__"),
    ).toBeNull();
  });

  it("has no verification card and no approve or reject", () => {
    expect(PANELS).not.toContain("verificationTitle");
    expect(PANELS).not.toContain("verifySupplier");
    expect(PANELS).not.toContain("rejectVerification");
  });
});

describe("the company card", () => {
  beforeEach(() => {
    patch.mockReset().mockResolvedValue({});
    refresh.mockReset();
  });

  it("keeps the email and the registration apart", () => {
    renderPage();

    expect(screen.getByTestId("company-owner-email")).toHaveTextContent(
      "info@emdad-example.com",
    );
    expect(screen.getByTestId("company-cr-number")).toHaveTextContent(
      "1012345678",
    );
    // Neither cell carries the other's value.
    expect(screen.getByTestId("company-owner-email")).not.toHaveTextContent(
      "1012345678",
    );
    expect(screen.getByTestId("company-cr-number")).not.toHaveTextContent("@");
  });

  it("renders both left-to-right", () => {
    renderPage();

    expect(screen.getByTestId("company-owner-email")).toHaveAttribute(
      "dir",
      "ltr",
    );
    expect(screen.getByTestId("company-cr-number")).toHaveAttribute(
      "dir",
      "ltr",
    );
  });

  it("lists every recorded number in one field", () => {
    renderPage();

    const phones = screen.getByTestId("company-phones");
    expect(phones).toHaveTextContent("+966 55 123 4567");
    expect(phones).toHaveTextContent("+966 11 234 5678");
    // Named where the number belongs to a contact.
    expect(phones).toHaveTextContent("المبيعات");
  });

  it("says so plainly when there are none", () => {
    renderPage({ phones: [] });

    expect(screen.getByText(detail.noPhones)).toBeInTheDocument();
  });

  it("turns its own cells into fields when asked, and not before", async () => {
    // «خلّ تعديل البيانات يعدّل البيانات اللي موجودة… وخلّها في جدول
    //  واحد وليس لكل جزء تعديل» — the table is the form. A page of
    //  open inputs is a page where a stray keystroke edits something,
    //  so nothing is editable until the band's button is pressed.
    const user = userEvent.setup();
    renderPage();

    expect(screen.queryByTestId("edit-legal-name")).toBeNull();
    expect(screen.queryByTestId("branch-name")).toBeNull();

    await user.click(screen.getByTestId("open-edit-company"));

    // The company's fields AND the branch row, in one press.
    expect(await screen.findByTestId("edit-legal-name")).toBeInTheDocument();
    expect(screen.getAllByTestId("branch-name")).toHaveLength(1);
  });

  it("sends only the fields that moved", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByTestId("open-edit-company"));
    const name = await screen.findByTestId("edit-legal-name");
    await user.clear(name);
    await user.type(name, "مؤسسة الإمداد");
    await user.click(screen.getByTestId("save-company"));

    await waitFor(() => expect(patch).toHaveBeenCalled());
    // A patch echoing unchanged values would write audit entries for
    // edits nobody made.
    expect(patch.mock.calls[0][1]).toEqual({ legalName: "مؤسسة الإمداد" });
  });

  it("cannot be saved when nothing changed", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByTestId("open-edit-company"));

    expect(await screen.findByTestId("save-company")).toBeDisabled();
  });

  it("asks for NO second factor to edit", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByTestId("open-edit-company"));

    expect(screen.queryByTestId("edit-totp")).toBeNull();
  });
});

describe("branches", () => {
  beforeEach(() => {
    post.mockReset().mockResolvedValue({});
    refresh.mockReset();
  });

  it("lists them in six columns", () => {
    renderPage();

    for (const header of [
      detail.branchName,
      detail.branchRegion,
      detail.branchAddress,
      detail.branchPhone,
      detail.branchLocation,
      detail.branchContact,
    ]) {
      expect(
        screen.getByRole("columnheader", { name: header }),
      ).toBeInTheDocument();
    }
    expect(screen.getAllByRole("columnheader")).toHaveLength(6);
  });

  it("shows a button rather than a long maps URL", () => {
    renderPage();

    const link = screen.getByTestId("branch-map-b1");
    expect(link).toHaveTextContent(detail.openLocation);
    // The URL is the href, not the text.
    expect(link.textContent).not.toContain("google.com");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(link).toHaveAttribute("rel", expect.stringContaining("noreferrer"));
  });

  it("says one short line when there are none", () => {
    renderPage({ locations: [] });

    expect(screen.getByTestId("no-branches")).toHaveTextContent(
      detail.noBranches,
    );
    // Not an empty table with six headers over nothing.
    expect(screen.queryByRole("columnheader")).toBeNull();
  });

  it("adds one as a row of the same table, saved with everything else", async () => {
    const user = userEvent.setup();
    renderPage();

    // It opens the editor and appends an empty row — there is no
    // second form, and no second save.
    await user.click(screen.getByTestId("open-add-branch"));
    await waitFor(() => expect(screen.getAllByTestId("branch-name")).toHaveLength(2));

    await user.type(lastRow("branch-name"), "فرع جدة");
    await pickRegion(user, "منطقة الرياض");
    await pickCity(user, "الرياض");
    await user.type(lastRow("branch-address"), "JJJD1111");
    await user.type(lastRow("branch-phone"), "0122222222");
    await user.type(lastRow("branch-contact"), "خالد");
    await user.type(
      lastRow("branch-map-url"),
      "https://www.google.com/maps?q=21.48,39.19",
    );
    await user.click(screen.getByTestId("save-company"));

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][0]).toContain("/branches");
    expect(post.mock.calls[0][1]).toMatchObject({
      name: "فرع جدة",
      cityId: "city-1",
    });
  });

  it("will not add one without a location link", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByTestId("open-add-branch"));
    await waitFor(() => expect(screen.getAllByTestId("branch-name")).toHaveLength(2));

    await user.type(lastRow("branch-name"), "فرع جدة");
    await pickRegion(user, "منطقة الرياض");
    await pickCity(user, "الرياض");
    await user.type(lastRow("branch-address"), "JJJD1111");
    await user.type(lastRow("branch-phone"), "0122222222");
    await user.type(lastRow("branch-contact"), "خالد");

    // A branch cannot be stored without a position — and an
    // incomplete row holds back the WHOLE save, because there is one.
    expect(screen.getByTestId("save-company")).toBeDisabled();
  });

  it("edits one in place, filled with what is stored", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByTestId("open-edit-company"));

    const name = (await screen.findByTestId(
      "branch-name",
    )) as HTMLInputElement;
    // Opening empty would invite retyping what was already right.
    expect(name.value).toBe("فرع الرياض");
  });

  it("sends a branch that moved and the company patch in one press", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByTestId("open-edit-company"));
    await user.clear(await screen.findByTestId("edit-legal-name"));
    await user.type(screen.getByTestId("edit-legal-name"), "الاسم الجديد");
    await user.clear(screen.getByTestId("branch-phone"));
    await user.type(screen.getByTestId("branch-phone"), "0111111111");
    await user.click(screen.getByTestId("save-company"));

    await waitFor(() => expect(patch).toHaveBeenCalledTimes(2));
    // The company first, then the branch that moved.
    expect(patch.mock.calls[0][1]).toEqual({ legalName: "الاسم الجديد" });
    expect(patch.mock.calls[1][0]).toContain("/branches/b1");
    expect(patch.mock.calls[1][1]).toMatchObject({
      contactPhone: "0111111111",
    });
  });
});

describe("activity", () => {
  const STRIP = strip(read("components/admin/company-activity-strip.tsx"));

  it("is four small cards, each one line high and edged in colour", () => {
    // «خلّ كل جزء في بطاقة، في طرفها لون… وتكون البطاقة بارتفاع صفّ
    //  واحد صغيرة، لا تجي بارتفاع كبير.»
    //
    // The label and the figure share a baseline, so a card is about
    // twenty-six pixels — which is what lets the four of them ride in
    // the title row instead of taking a row of their own.
    expect(STRIP).toContain("metric-");
    expect(STRIP).toContain("items-baseline");
    expect(STRIP).toContain("border-s-4");

    // FROM THE PLATFORM'S OWN TOKENS. A hex literal here would be a
    // fifth colour nothing else on the console uses.
    for (const edge of [
      "border-s-secondary",
      "border-s-accent",
      "border-s-primary",
      "border-s-danger",
    ]) {
      expect(STRIP).toContain(edge);
    }
  });

  it("rides in the title row, not in a row of its own", () => {
    // «ارفعها في الشريط اللي فوقها في المساحة الفاضية بين اسم المورّد
    //  أو المشتري وأزرار التوثيق.»
    const header = DETAIL.slice(
      DETAIL.indexOf("<header"),
      DETAIL.indexOf("</header>"),
    );
    expect(header).toContain("<CompanyActivityStrip");
  });

  it("carries no heading and no explanation", () => {
    // It stands directly beneath the company's name and every reading
    // is labelled; a title over four labelled numbers is the standing
    // explanation this console does not carry.
    expect(STRIP).not.toContain("activityTitle");
    expect(STRIP).not.toContain("activityNote");
    expect(STRIP).not.toContain("footprintNote");
  });
});

describe("suspension", () => {
  beforeEach(() => {
    post.mockReset().mockResolvedValue({});
    refresh.mockReset();
  });

  it("shows a button and no field until it is pressed", async () => {
    // «خلّها زرّين فقط بدون حقل سبب، إذا ضغطت الزر يفتح لي حقل السبب
    //  وجنبه كلمة تأكيد.»
    const user = userEvent.setup();
    renderPage();

    expect(screen.queryByTestId("company-suspend-reason")).toBeNull();
    await user.click(screen.getByTestId("company-suspend-open"));
    expect(screen.getByTestId("company-suspend-reason")).toBeInTheDocument();
  });

  it("will not run without a reason", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByTestId("company-suspend-open"));
    expect(screen.getByTestId("company-suspend-submit")).toBeDisabled();
  });

  it("runs with one, and asks for NO second factor", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByTestId("company-suspend-open"));
    await user.type(
      screen.getByTestId("company-suspend-reason"),
      "مخالفة متكررة",
    );
    expect(screen.getByTestId("company-suspend-submit")).toBeEnabled();

    await user.click(screen.getByTestId("company-suspend-submit"));

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][0]).toContain("/suspend");
    expect(post.mock.calls[0][1]).toEqual({ reason: "مخالفة متكررة" });
    expect(JSON.stringify(post.mock.calls[0][1])).not.toContain("totp");
  });

  it("offers reactivation instead when the company is stopped", async () => {
    const user = userEvent.setup();
    renderPage({ verificationStatus: "SUSPENDED" });

    expect(screen.queryByTestId("company-suspend-open")).toBeNull();

    await user.click(screen.getByTestId("company-reactivate-open"));
    await user.type(
      screen.getByTestId("company-reactivate-reason"),
      "انتهى سبب الإيقاف",
    );
    await user.click(screen.getByTestId("company-reactivate-submit"));

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][0]).toContain("/reactivate");
  });
});

describe("removal", () => {
  beforeEach(() => {
    del.mockReset().mockResolvedValue({});
  });

  it("names what blocks it, and asks for nothing more", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByTestId("delete-open"));
    expect(screen.getByTestId("delete-blocked")).toHaveTextContent("طلبات");
    expect(screen.getByTestId("delete-blocked")).toHaveTextContent("24");
    // No name to type, for a button that cannot be pressed.
    expect(screen.queryByTestId("delete-confirmation")).toBeNull();
    expect(screen.getByTestId("delete-submit")).toBeDisabled();
  });

  it("asks for the name only when removal is possible", async () => {
    const user = userEvent.setup();
    renderPage({}, true);

    await user.click(screen.getByTestId("delete-open"));
    expect(screen.getByTestId("delete-confirmation")).toBeInTheDocument();
    expect(screen.queryByTestId("delete-blocked")).toBeNull();
  });

  it("asks for NO authenticator code", async () => {
    // A code says who is at the keyboard, which the session already
    // established. It says nothing about WHICH company is on screen —
    // and that is what the typed name below is for.
    const user = userEvent.setup();
    renderPage({}, true);

    await user.click(screen.getByTestId("delete-open"));
    expect(screen.queryByTestId("delete-totp")).toBeNull();
  });

  it("stays unpressable until both are given", async () => {
    const user = userEvent.setup();
    renderPage({}, true);

    await user.click(screen.getByTestId("delete-open"));
    await user.type(screen.getByTestId("delete-reason"), "طلب المالك");
    expect(screen.getByTestId("delete-submit")).toBeDisabled();

    await user.type(screen.getByTestId("delete-confirmation"), "1012345678");
    expect(screen.getByTestId("delete-submit")).toBeEnabled();
  });

  it("refuses a confirmation that matches neither the name nor the registration", async () => {
    const user = userEvent.setup();
    renderPage({}, true);

    await user.click(screen.getByTestId("delete-open"));
    await user.type(screen.getByTestId("delete-reason"), "طلب المالك");
    await user.type(screen.getByTestId("delete-confirmation"), "شيء آخر");

    expect(screen.getByTestId("delete-submit")).toBeDisabled();
  });

  it("sends the reason and the confirmation together", async () => {
    const user = userEvent.setup();
    renderPage({}, true);

    await user.click(screen.getByTestId("delete-open"));
    await user.type(screen.getByTestId("delete-reason"), "طلب المالك");
    await user.type(screen.getByTestId("delete-confirmation"), "1012345678");
    await user.click(screen.getByTestId("delete-submit"));

    await waitFor(() => expect(del).toHaveBeenCalled());
    expect(del.mock.calls[0][1]).toEqual({
      reason: "طلب المالك",
      confirmation: "1012345678",
    });
  });
});

describe("both languages", () => {
  it("carries every label in English too", () => {
    for (const key of [
      "detailsTitle",
      "phones",
      "branchesTitle",
      "branchAddress",
      "openLocation",
      "mapUrl",
      "noBranches",
      "activityTitle",
      "suspendTitle",
      "reactivateTitle",
      "deleteReason",
    ]) {
      expect(en.admin.companyDetail).toHaveProperty(key);
      const value = (en.admin.companyDetail as Record<string, unknown>)[key];
      expect(typeof value).toBe("string");
      expect(String(value).length).toBeGreaterThan(0);
    }
  });

  it("dropped the labels the tabs used to need", () => {
    // A message nobody renders is a message that drifts.
    expect(messages.admin.companyDetail).not.toHaveProperty("tabActivity");
    expect(messages.admin.companyDetail).not.toHaveProperty("tabManagement");
    expect(messages.admin.companyDetail).not.toHaveProperty(
      "verificationTitle",
    );
  });
});

describe("the three faults reported from the real page", () => {
  beforeEach(() => {
    patch.mockReset().mockResolvedValue({});
    post.mockReset().mockResolvedValue({});
    refresh.mockReset();
  });

  describe("1. the registration is editable, without a code", () => {
    it("offers the field in the ordinary edit form", async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(screen.getByTestId("open-edit-company"));

      expect(await screen.findByTestId("edit-cr-number")).toHaveValue(
        "1012345678",
      );
      // No authenticator anywhere in this form.
      expect(screen.queryByTestId("edit-totp")).toBeNull();
    });

    it("sends it as an ordinary patch", async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(screen.getByTestId("open-edit-company"));
      const field = await screen.findByTestId("edit-cr-number");
      await user.clear(field);
      await user.type(field, "1012345679");
      await user.click(screen.getByTestId("save-company"));

      await waitFor(() => expect(patch).toHaveBeenCalled());
      expect(patch.mock.calls[0][1]).toEqual({ crNumber: "1012345679" });
      // Not through a second route with its own rules.
      expect(post).not.toHaveBeenCalled();
    });

    it("says what still constrains it", async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(screen.getByTestId("open-edit-company"));

      expect(await screen.findByText(detail.crNumberHint)).toBeInTheDocument();
    });
  });

  describe("2. the branch link explains itself", () => {
    it("ACCEPTS a share link, and lets the server follow it", async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(screen.getByTestId("open-add-branch"));
      await waitFor(() =>
        expect(screen.getAllByTestId("branch-name")).toHaveLength(2),
      );
      await user.type(lastRow("branch-name"), "فرع جدة");
      await pickRegion(user, "منطقة الرياض");
      await pickCity(user, "الرياض");
      await user.type(lastRow("branch-address"), "JJJD1111");
      await user.type(lastRow("branch-phone"), "0122222222");
      await user.type(lastRow("branch-contact"), "خالد");
      // The link the "share" button gives you. The form used to refuse
      // it and send the operator to fetch a different one; the server
      // now follows the redirect for them.
      await user.type(
        lastRow("branch-map-url"),
        "https://maps.app.goo.gl/AbCd123",
      );

      expect(screen.queryByTestId("branch-map-rejected")).toBeNull();
      expect(screen.getByTestId("save-company")).toBeEnabled();

      await user.click(screen.getByTestId("save-company"));
      await waitFor(() => expect(post).toHaveBeenCalled());
      expect(post.mock.calls[0][1].mapUrl).toBe(
        "https://maps.app.goo.gl/AbCd123",
      );
    });

    it("still refuses something that is not a maps link at all", async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(screen.getByTestId("open-add-branch"));
      await user.type(
        await lastRow("branch-map-url"),
        "the shop next to the mosque",
      );

      expect(screen.getByTestId("branch-map-rejected")).toBeInTheDocument();
      expect(post).not.toHaveBeenCalled();
    });

    it("refuses another site that carries no coordinates", async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(screen.getByTestId("open-add-branch"));
      await user.type(
        await lastRow("branch-map-url"),
        "https://example.com/place/riyadh",
      );

      // Not a Google host, and no numbers in it either — so there is
      // nothing to follow and nothing to read.
      expect(screen.getByTestId("branch-map-rejected")).toBeInTheDocument();
    });

    it("takes explicit coordinates wherever they are written", async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(screen.getByTestId("open-add-branch"));
      await user.type(
        await lastRow("branch-map-url"),
        "https://example.com/?q=24.77,46.73",
      );

      // A pair of coordinates IS a place, whoever wrote the URL around
      // them. Nothing is fetched — they are read from the text.
      expect(screen.queryByTestId("branch-map-rejected")).toBeNull();
    });

    it("accepts a link that carries coordinates", async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(screen.getByTestId("open-add-branch"));
      await user.type(
        await lastRow("branch-map-url"),
        "https://www.google.com/maps?q=21.48,39.19",
      );

      expect(screen.queryByTestId("branch-map-rejected")).toBeNull();
    });

    it("accepts a bare pair of coordinates", async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(screen.getByTestId("open-add-branch"));
      await user.type(
        await lastRow("branch-map-url"),
        "21.485811,39.192505",
      );

      expect(screen.queryByTestId("branch-map-rejected")).toBeNull();
    });

    it("carries a message for the code the server now sends", () => {
      // The reason used to arrive as the generic "the data entered is
      // not valid", which named neither the field nor the cause.
      expect(messages.errors.codes).toHaveProperty(
        "BRANCH_LOCATION_UNREADABLE",
      );
      expect(en.errors.codes).toHaveProperty("BRANCH_LOCATION_UNREADABLE");
      expect(messages.errors.codes.BRANCH_LOCATION_UNREADABLE).toContain(
        "خرائط Google",
      );
      // It no longer tells an operator to go and copy a different link.
      expect(messages.admin.companyDetail.mapUrlHint).toContain("المشاركة");
    });
  });

  describe("3. the activity row lines up", () => {
    it("isolates the digits without changing the cell's alignment", () => {
      // THE FAULT: `dir="ltr"` on the cell moved its text to the left
      // while the heading above stayed on the right, so every label and
      // its number sat at opposite ends of the column.
      //
      // MEASURED ON THE STRIP, which is where the figures moved when
      // the summary became one gauge under the company's name. The
      // fault travels with the markup, so the guard does too.
      renderStrip();

      const value = screen.getByTestId("metric-purchases");
      expect(value).not.toHaveAttribute("dir");
      expect(value.querySelector("bdi")).not.toBeNull();
      expect(value).toHaveTextContent("128,475.00");
    });

    it("does the same for every other figure", () => {
      renderStrip();

      for (const testId of [
        "metric-orders",
        "metric-opportunities",
        "metric-disputes",
      ]) {
        expect(screen.getByTestId(testId)).not.toHaveAttribute("dir");
      }
    });

    it("keeps a telephone's parts in order without moving it either", () => {
      renderPage();

      const phones = screen.getByTestId("company-phones");
      expect(phones.querySelectorAll("bdi").length).toBeGreaterThan(0);
      expect(phones).toHaveTextContent("+966 55 123 4567");
    });
  });
});

describe("the ordering and the last standing hint", () => {
  it("carries NO sentence under the confirmation field", async () => {
    // The rule was refused outright: no standing explanations. What to
    // type is shown IN the field as its placeholder, and the button
    // enforces the rule rather than a line of prose narrating it.
    const user = userEvent.setup();
    renderPage({}, true);

    await user.click(screen.getByTestId("delete-open"));
    const field = screen.getByTestId("delete-confirmation");
    expect(field).toHaveAttribute("placeholder", "1012345678");

    // NOTHING AFTER THE INPUT — which is where a standing hint would
    // go, and the only place this rule is about.
    //
    // Measured on what FOLLOWS the field rather than on "any span in
    // the wrapper": the label above it is markup of its own, and a
    // label that grows a span — as it did when every field on
    // «استكمال بيانات المنشأة» gained its mark — is not a hint under
    // a field and must not read as one.
    let after = field.nextElementSibling;
    while (after) {
      expect([after.tagName, after.textContent]).toEqual([after.tagName, ""]);
      after = after.nextElementSibling;
    }
  });

  it("dropped the message that carried it", () => {
    expect(messages.admin.companyDetail).not.toHaveProperty(
      "deleteConfirmationHint",
    );
    expect(en.admin.companyDetail).not.toHaveProperty("deleteConfirmationHint");
    expect(PANELS).not.toContain("deleteConfirmHint");
  });

  it("puts the audit trail LAST, below both dangerous sections", () => {
    // It is the only section that grows without limit. Above them it
    // pushed suspension and removal further down the page with every
    // recorded action, so the longer a company's history, the harder
    // its controls were to reach.
    // Measured inside the RENDER BODY, not across the whole file: the
    // helper components are defined below it, so file order says
    // nothing about the order they appear on screen.
    const body = PANELS.slice(
      PANELS.indexOf("export function CompanyPanels"),
      PANELS.indexOf("function Block("),
    );

    // The two are one component now — two buttons at the foot of the
    // record, each opening its own reason — so the claim is that they
    // stand below the record and the trail stands below them.
    const bank = body.indexOf("labels.bankTitle");
    const stop = body.indexOf("<StopActions");
    const audit = body.indexOf("labels.auditTitle");

    expect(bank).toBeGreaterThan(0);
    expect(stop).toBeGreaterThan(bank);
    expect(audit).toBeGreaterThan(stop);
  });

  it("renders them in that order in the DOM too", () => {
    renderPage();

    const cards = Array.from(
      document.querySelectorAll("[data-testid^='card-']"),
    ).map((node) => node.getAttribute("data-testid"));

    expect(cards).toEqual([
      "card-company-record",
      "card-company-details",
      "card-branches",
      "card-company-bank",
      "card-company-stop",
      "card-audit",
    ]);
  });
});
