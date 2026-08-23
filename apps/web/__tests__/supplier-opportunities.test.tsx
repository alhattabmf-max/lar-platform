import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SUPPLIER_OPPORTUNITY_DETAIL_KEYS,
  SUPPLIER_OPPORTUNITY_REASON_CODES,
  SUPPLIER_OPPORTUNITY_STATUSES,
  SUPPLIER_OPPORTUNITY_SUMMARY_KEYS,
  isMoneyString,
  type SupplierOpportunityStatus,
} from "@platform/types";
import {
  opportunityActions,
  opportunityNeedsAttention,
  opportunityNextStepKey,
} from "@/lib/opportunity-actions";

const ROOT = join(__dirname, "..");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");
const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const LIST = read("app/[locale]/supplier/opportunities/page.tsx");
const DETAIL = read("app/[locale]/supplier/opportunities/[id]/page.tsx");
const ACTIONS = read("components/supplier/opportunity-actions.tsx");
const SUPPLIER_DATA = read("lib/supplier-data.ts");
const MONEY = read("lib/money.ts");

const NOW = new Date("2026-08-10T00:00:00.000Z");
const FUTURE = "2026-08-20T00:00:00.000Z";
const PAST = "2026-08-01T00:00:00.000Z";

// ------------------------------------------------------- action gating

/**
 * The gate, checked against the API's own guards.
 *
 * update  — EDITABLE_STATUSES = DRAFT, SCHEDULED, ACTION_REQUIRED.
 * publish — DRAFT or ACTION_REQUIRED only.
 * extend  — ACTIVE, and additionally `extendedAt === null` and `endAt`
 *           still in the future.
 * delete  — DRAFT only.
 */
describe("action gating matches the API's guards, state by state", () => {
  const live = (status: SupplierOpportunityStatus) => ({
    status,
    extendedAt: null,
    endAt: FUTURE,
  });

  it.each([
    ["DRAFT", true],
    ["SCHEDULED", true],
    ["ACTION_REQUIRED", true],
    ["ACTIVE", false],
    ["PAUSED", false],
    ["FUNDED", false],
    ["EXPIRED", false],
    ["CANCELLED", false],
  ] as const)("update from %s -> %s", (status, allowed) => {
    expect(opportunityActions(live(status), NOW).canUpdate).toBe(allowed);
  });

  it.each([
    ["DRAFT", true],
    ["ACTION_REQUIRED", true],
    ["SCHEDULED", false],
    ["ACTIVE", false],
    ["PAUSED", false],
    ["FUNDED", false],
    ["EXPIRED", false],
    ["CANCELLED", false],
  ] as const)("publish from %s -> %s", (status, allowed) => {
    expect(opportunityActions(live(status), NOW).canPublish).toBe(allowed);
  });

  it.each([
    ["DRAFT", true],
    ["SCHEDULED", false],
    ["ACTION_REQUIRED", false],
    ["ACTIVE", false],
    ["PAUSED", false],
    ["FUNDED", false],
    ["EXPIRED", false],
    ["CANCELLED", false],
  ] as const)("delete from %s -> %s", (status, allowed) => {
    expect(opportunityActions(live(status), NOW).canDelete).toBe(allowed);
  });

  it.each([
    ["ACTIVE", true],
    ["DRAFT", false],
    ["SCHEDULED", false],
    ["ACTION_REQUIRED", false],
    ["PAUSED", false],
    ["FUNDED", false],
    ["EXPIRED", false],
    ["CANCELLED", false],
  ] as const)("extend from %s -> %s", (status, allowed) => {
    expect(opportunityActions(live(status), NOW).canExtend).toBe(allowed);
  });

  it("refuses a second extension, because the API allows exactly one", () => {
    expect(
      opportunityActions({ status: "ACTIVE", extendedAt: PAST, endAt: FUTURE }, NOW).canExtend
    ).toBe(false);
  });

  it("refuses to extend a listing that has already ended", () => {
    // The service checks `endAt <= now` separately from the status, so a
    // still-ACTIVE row past its end cannot be extended.
    expect(
      opportunityActions({ status: "ACTIVE", extendedAt: null, endAt: PAST }, NOW).canExtend
    ).toBe(false);
  });

  it("covers all eight statuses and nothing else", () => {
    expect(SUPPLIER_OPPORTUNITY_STATUSES).toHaveLength(8);
  });

  it("gives every status a next step", () => {
    const messages = JSON.parse(read("messages/ar-SA.json")).supplier.opportunities.nextStep;

    for (const status of SUPPLIER_OPPORTUNITY_STATUSES) {
      const key = opportunityNextStepKey(status);
      const value = key.split(".").reduce<unknown>((node, part) => (node as never)[part], messages);
      expect(value, status).toBeTruthy();
    }
  });

  it("flags exactly the states where the supplier must act", () => {
    for (const status of SUPPLIER_OPPORTUNITY_STATUSES) {
      expect([status, opportunityNeedsAttention(status)]).toEqual([
        status,
        status === "DRAFT" || status === "ACTION_REQUIRED",
      ]);
    }
  });

  it("reads its vocabularies from the shared contract, not a local list", () => {
    const code = strip(read("lib/opportunity-actions.ts"));

    expect(code).toContain("SUPPLIER_OPPORTUNITY_EDITABLE_STATUSES");
    expect(code).toContain("SUPPLIER_OPPORTUNITY_PUBLISHABLE_STATUSES");
    expect(code).toContain("SUPPLIER_OPPORTUNITY_DELETABLE_STATUSES");
    expect(code).toContain("SUPPLIER_OPPORTUNITY_EXTENDABLE_STATUSES");
  });
});

describe("no button is rendered for an action the API would refuse", () => {
  it("drives every control from the gate, never from a raw status", () => {
    const code = strip(DETAIL);

    expect(code).toContain("opportunityActions(opportunity)");
    expect(code).toContain("gate={gate}");
    expect(code).not.toMatch(/status === "DRAFT"/);
  });

  it("renders nothing when no action is allowed", () => {
    expect(strip(ACTIONS)).toContain("if (available.length === 0) return null");
  });

  it("offers no edit or create form while neither screen exists", () => {
    // PATCH and POST exist; the field-editing screen does not. A control
    // that opens nothing promises an action the product cannot perform.
    for (const source of [strip(LIST), strip(DETAIL), strip(ACTIONS)]) {
      expect(source).not.toContain("<form");
      expect(source).not.toContain("onSubmit");
      expect(source).not.toContain("apiClient.patch");
    }
    expect(strip(LIST)).not.toMatch(/<Button\b/);
  });

  it("exposes only the three input-free actions", () => {
    const code = strip(ACTIONS);

    expect(code).toContain('"publish" | "extend" | "delete"');
    expect(code).not.toContain("canUpdate");
  });
});

// -------------------------------------------------------------- writes

const gateAll = { canUpdate: false, canPublish: true, canExtend: true, canDelete: true };

const LABELS = {
  publish: "نشر",
  publishPrompt: "تأكيد النشر؟",
  extend: "تمديد",
  extendPrompt: "تأكيد التمديد؟",
  delete: "حذف",
  deletePrompt: "تأكيد الحذف؟",
  confirm: "تأكيد",
  cancel: "إلغاء",
  working: "جارٍ التنفيذ…",
  errorTitle: "تعذّر إتمام الطلب",
  requestIdLabel: "رقم المرجع",
};

const refreshMock = vi.fn();
const replaceMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, replace: replaceMock }),
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

const { OpportunityActions } = await import("@/components/supplier/opportunity-actions");

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  refreshMock.mockReset();
  replaceMock.mockReset();
  fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ id: "o-1" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderActions(gate = gateAll) {
  return render(
    <OpportunityActions
      opportunityId="o-1"
      gate={gate}
      listHref="/ar-SA/supplier/opportunities"
      labels={LABELS}
    />
  );
}

describe("publish, extend and delete", () => {
  it("asks before publishing, then posts to the real endpoint", async () => {
    renderActions();

    fireEvent.click(screen.getByText(LABELS.publish));
    expect(await screen.findByText(LABELS.publishPrompt)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText(LABELS.confirm));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/v1/companies/me/opportunities/o-1/publish");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("asks before extending — it is allowed once and cannot be undone", async () => {
    renderActions();

    fireEvent.click(screen.getByText(LABELS.extend));
    fireEvent.click(await screen.findByText(LABELS.confirm));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    expect(String(fetchMock.mock.calls[0][0])).toContain("/opportunities/o-1/extend");
  });

  it("navigates to the list after a delete rather than refreshing into a 404", async () => {
    renderActions();

    fireEvent.click(screen.getByText(LABELS.delete));
    fireEvent.click(await screen.findByText(LABELS.confirm));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
    expect(replaceMock).toHaveBeenCalledWith("/ar-SA/supplier/opportunities");
  });

  it("refuses a second write while one is in flight", async () => {
    let release: (value: Response) => void = () => {};
    fetchMock.mockImplementation(
      () => new Promise<Response>((resolve) => (release = resolve))
    );

    renderActions();
    fireEvent.click(screen.getByText(LABELS.publish));

    const confirm = await screen.findByText(LABELS.confirm);
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    expect(fetchMock).toHaveBeenCalledTimes(1);

    release(new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
  });

  it("shows a closed message when publishing is refused, and no raw detail", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "SUPPLIER_NOT_VERIFIED",
            message: "Your company is no longer a verified supplier.",
          },
          requestId: "req-7",
        }),
        { status: 403, headers: { "content-type": "application/json" } }
      )
    );

    renderActions();
    fireEvent.click(screen.getByText(LABELS.publish));
    fireEvent.click(await screen.findByText(LABELS.confirm));

    const alert = await screen.findByRole("alert");

    expect(within(alert).getByText("errors.codes.SUPPLIER_NOT_VERIFIED")).toBeInTheDocument();
    // The operator-facing English detail string must not appear.
    expect(alert.textContent).not.toContain("verified supplier");
    expect(alert.textContent).toContain("req-7");
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("fabricates no status and re-reads the server instead", () => {
    const code = strip(ACTIONS);

    expect(code).toContain("router.refresh()");
    expect(code).not.toContain("setStatus");
    expect(code).not.toContain("optimistic");
  });

  it("sends no Idempotency-Key, because these endpoints take none", () => {
    expect(strip(ACTIONS)).not.toContain("Idempotency");
  });

  it("relies on apiClient for Origin and cookies rather than fetching directly", () => {
    const code = strip(ACTIONS);

    expect(code).not.toContain("fetch(");
    expect(code).not.toContain("credentials");
    expect(code).toContain('from "@/lib/api-client"');
  });

  it("gives every control a 44px touch target", () => {
    const { container } = renderActions();

    for (const button of container.querySelectorAll("button")) {
      expect(button.className).toContain("min-h-11");
    }
  });
});

// ---------------------------------------------------------------- money

describe("money is a decimal string end to end", () => {
  it("declares the four amounts as strings on the shared contract", () => {
    const contract = readFileSync(
      join(ROOT, "..", "..", "packages", "types", "src", "contracts", "supplier-opportunity.ts"),
      "utf8"
    );

    expect(contract).toContain("unitPriceAmount: MoneyString");
    expect(contract).toContain("unitPriceExclTaxAmount: MoneyString | null");
    expect(contract).toContain("unitTaxAmount: MoneyString | null");
    expect(contract).toContain("totalValueInclTaxAmount: MoneyString | null");
    // The shared money type, not a locally declared pattern.
    expect(contract).toContain('from "./money"');
    expect(contract).not.toMatch(/\/\^.*\\d\{2\}\$\//);
  });

  it("accepts the API's shape at runtime", () => {
    for (const value of ["11.50", "1150.00", "0.00", "-75.25"]) {
      expect(isMoneyString(value)).toBe(true);
    }
    // The old wire shape. This is what the web app would have received.
    expect(isMoneyString(11.5)).toBe(false);
    expect(isMoneyString("11.5")).toBe(false);
  });

  it("still offers no number entry point for money in the web app", () => {
    // A `formatMoneyFromApiNumber` is exactly what this batch would have
    // needed to avoid fixing the API. It stays deleted.
    expect(MONEY).not.toContain("formatMoneyFromApiNumber");
    expect(MONEY).not.toMatch(/export function formatMoney\([^)]*amount: number/);
  });

  it("does no arithmetic on any amount", () => {
    for (const source of [strip(LIST), strip(DETAIL)]) {
      expect(source).toContain("formatMoney");
      expect(source).not.toContain("parseFloat");
      expect(source).not.toMatch(/Number\(\s*opportunity\./);
      expect(source).not.toMatch(/[Aa]mount\s*[*+\-/]\s*/);
      expect(source).not.toMatch(/reduce\(/);
    }
  });

  it("prints funded and target as two counts, never a computed percentage", () => {
    // `fundedQuantity / targetQuantity` would be a second source of truth
    // for progress. The two numbers are shown side by side instead.
    for (const source of [strip(LIST), strip(DETAIL)]) {
      expect(source).toContain("fundedOfTarget");
      expect(source).not.toMatch(/fundedQuantity\s*\/\s*/);
    }
  });

  it("renders the FROZEN tax breakdown and recomputes nothing", () => {
    const code = strip(DETAIL);

    expect(code).toContain("taxFrozenNotice");
    expect(code).toContain("opportunity.unitPriceExclTaxAmount");
    expect(code).toContain("opportunity.unitTaxAmount");
    expect(code).not.toMatch(/unitPriceAmount[^)]*taxRatePercent/);
  });

  it("omits the tax card entirely before the first publish", () => {
    // Null, not zero: a zero would be a claim that no tax applies.
    expect(strip(DETAIL)).toContain("{exclTax || tax || totalValue ?");
  });
});

// ---------------------------------------------------------- ACTION_REQUIRED

describe("ACTION_REQUIRED is translated, with a fix for each reason", () => {
  const ar = JSON.parse(read("messages/ar-SA.json")).supplier;
  const en = JSON.parse(read("messages/en-SA.json")).supplier;

  it("translates all ten reason codes in both locales", () => {
    expect(SUPPLIER_OPPORTUNITY_REASON_CODES).toHaveLength(10);

    for (const code of SUPPLIER_OPPORTUNITY_REASON_CODES) {
      expect(ar.status.opportunityReason[code], code).toBeTruthy();
      expect(en.status.opportunityReason[code], code).toBeTruthy();
    }
    expect(Object.keys(ar.status.opportunityReason).sort()).toEqual(
      [...SUPPLIER_OPPORTUNITY_REASON_CODES].sort()
    );
  });

  it("pairs every reason code with a fix", () => {
    expect(Object.keys(ar.opportunities.reasonFix).sort()).toEqual(
      [...SUPPLIER_OPPORTUNITY_REASON_CODES].sort()
    );
    expect(Object.keys(en.opportunities.reasonFix).sort()).toEqual(
      [...SUPPLIER_OPPORTUNITY_REASON_CODES].sort()
    );
  });

  it("says plainly when the fix is not the supplier's to make", () => {
    // TAX_RATE_NOT_CONFIGURED is a platform-side condition. Telling
    // someone to correct it would send them looking for a setting they
    // do not have.
    expect(en.opportunities.reasonFix.TAX_RATE_NOT_CONFIGURED.toLowerCase()).toContain(
      "nothing for you to correct"
    );
  });

  it("shows the reason code, never the row's operator-facing details", () => {
    const code = strip(DETAIL);

    expect(code).toContain("opportunityReason.${opportunity.reasonCode}");
    expect(code).toContain("reasonFix.${opportunity.reasonCode}");
    expect(code).not.toContain("reasonDetails");
  });

  it("has no reasonDetails on the contract at all, so there is nothing to leak", () => {
    expect([...SUPPLIER_OPPORTUNITY_DETAIL_KEYS]).not.toContain("reasonDetails");
    expect(SUPPLIER_DATA).not.toContain("reasonDetails");
  });
});

// ---------------------------------------------------------------- pages

describe("the list and detail pages", () => {
  it("read the closed contracts", () => {
    const code = strip(SUPPLIER_DATA);

    expect(code).toContain("SupplierOpportunitySummary[]");
    expect(code).toContain("SupplierOpportunityDetail");
    expect(code).toContain('load<SupplierOpportunitySummary[]>("/companies/me/opportunities")');
  });

  it("matches the contract's own key lists", () => {
    expect(SUPPLIER_OPPORTUNITY_SUMMARY_KEYS.length).toBeGreaterThan(0);
    expect([...SUPPLIER_OPPORTUNITY_DETAIL_KEYS]).toEqual(
      expect.arrayContaining([...SUPPLIER_OPPORTUNITY_SUMMARY_KEYS])
    );
  });

  it("answers an unknown or another company's id with a real 404", () => {
    const code = strip(DETAIL);

    expect(code).toContain("if (!result.ok && result.notFound) notFound()");
    expect(code).toContain('from "next/navigation"');
  });

  it("puts what needs attention first and hides it when empty", () => {
    const code = strip(LIST);

    expect(code).toContain("opportunityNeedsAttention");
    expect(code).toContain("attention.length > 0 ?");
    expect(code.indexOf("needsAttention.title")).toBeLessThan(code.indexOf("allTitle"));
  });

  it("has a loading, error and empty state on the list", () => {
    const code = strip(LIST);

    expect(code).toContain("<Suspense");
    expect(code).toContain("<LoadingState");
    expect(code).toContain("<ErrorState");
    expect(code).toContain("<EmptyState");
  });

  it("renders every status through a translation, never the raw enum", () => {
    for (const source of [strip(LIST), strip(DETAIL)]) {
      expect(source).toContain("opportunity.${opportunity.status}");
      expect(source).not.toMatch(/[^$]\{\s*opportunity\.status\s*\}/);
    }
  });

  it("shows no trader and no internal policy field", () => {
    // "traders" appears in prose ("offered to traders") and
    // `components/trader/status-badge` is a shared import — neither is a
    // trader DATA field, which is what must be absent.
    for (const source of [LIST, DETAIL, SUPPLIER_DATA]) {
      for (const forbidden of [
        "traderCompanyId",
        "traderId",
        "checkoutSession",
        "paymentAttempt",
        "masterOrder",
        "shareBasisPoints",
        "shareTierPolicyVersionId",
        "commissionPolicyVersionId",
        "commissionRateBasisPoints",
        "productApprovalSnapshotId",
        "pauseReason",
        "cancelReason",
      ]) {
        expect(source, forbidden).not.toContain(forbidden);
      }
    }
  });

  it("re-guards on both pages and adds no AppShell", () => {
    for (const source of [strip(LIST), strip(DETAIL)]) {
      expect(source).toContain('requireRoleOrRedirect(appLocale, "SUPPLIER")');
      expect(source).not.toContain("<AppShell");
      expect(source).not.toContain("force-dynamic");
    }
  });

  it("invents no pager over an unpaginated endpoint", () => {
    expect(strip(LIST)).not.toContain("Pagination");
    expect(strip(LIST)).not.toContain("page=");
  });
});

describe("navigation and message parity", () => {
  it("turns the opportunities nav item into a real link now that the pages exist", async () => {
    const { SUPPLIER_NAV_DESTINATIONS } = await import("@/components/shell/supplier-nav");
    const opportunities = SUPPLIER_NAV_DESTINATIONS.find((d) => d.key === "opportunities")!;

    expect(opportunities.built).toBe(true);
    expect(
      existsSync(join(ROOT, "app", "[locale]", "supplier", "opportunities", "page.tsx"))
    ).toBe(true);
    expect(
      existsSync(join(ROOT, "app", "[locale]", "supplier", "opportunities", "[id]", "page.tsx"))
    ).toBe(true);
  });

  it("ships identical opportunity keys in both locales", () => {
    const ar = JSON.parse(read("messages/ar-SA.json")).supplier;
    const en = JSON.parse(read("messages/en-SA.json")).supplier;

    const flatten = (value: unknown, prefix = ""): string[] =>
      typeof value !== "object" || value === null
        ? [prefix]
        : Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
            flatten(v, prefix ? `${prefix}.${k}` : k)
          );

    expect(flatten(ar.opportunities).sort()).toEqual(flatten(en.opportunities).sort());
    expect(Object.keys(ar.status.opportunity).sort()).toEqual(
      [...SUPPLIER_OPPORTUNITY_STATUSES].sort()
    );
  });
});
