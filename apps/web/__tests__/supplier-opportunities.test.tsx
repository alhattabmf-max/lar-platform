import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
  type OpportunityGateInput,
} from "@/lib/opportunity-actions";

const ROOT = join(__dirname, "..");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");
const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const LIST = read("app/[locale]/supplier/opportunities/page.tsx");
const DETAIL = read("app/[locale]/supplier/opportunities/[id]/page.tsx");
// One product on one row — the list's card is its own file now.
const ROW_CARD = read("components/supplier/product-row-card.tsx");
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
 * delete  — EVERY state. The route decides between erasing the rows and
 *           archiving them from what the listing carries, and refuses
 *           only while a buyer holds a live lock.
 */
describe("action gating matches the API's guards, state by state", () => {
  const live = (status: SupplierOpportunityStatus) => ({
    status,
    // A GROUP OFFER, which is what every case in this block is about:
    // a window, an extension, a decision when it closes short. The
    // direct listing has its own case below.
    saleMode: "GROUP" as const,
    extendedAt: null,
    endAt: FUTURE,
    decisionWindowClosesAt: null,
    fundedQuantity: 0,
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
    ["SCHEDULED", true],
    ["ACTION_REQUIRED", true],
    ["ACTIVE", true],
    ["PAUSED", true],
    ["FUNDED", true],
    ["EXPIRED", true],
    ["CANCELLED", true],
  ] as const)("delete from %s -> %s", (status, allowed) => {
    // EVERY STATE NOW, and it used to be DRAFT alone. That was right
    // while delete meant erase: a listing with a sold unit cannot be
    // erased without leaving invoices and settlements pointing at
    // nothing. `DELETE /companies/me/listings/:id` archives exactly
    // those and erases only what nobody ever touched — so "may I remove
    // this?" has one answer, and WHAT HAPPENS is decided by the data.
    //
    // The one refusal left is not a state: a buyer holding a live lock
    // is a person mid-purchase, and the API answers 409 until it
    // expires. A gate here cannot see that, and must not pretend to.
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
      opportunityActions(
        {
          status: "ACTIVE",
          saleMode: "GROUP" as const,
          extendedAt: PAST,
          endAt: FUTURE,
          decisionWindowClosesAt: null,
          fundedQuantity: 0,
        },
        NOW,
      ).canExtend,
    ).toBe(false);
  });

  it("refuses to extend a listing that has already ended", () => {
    // The service checks `endAt <= now` separately from the status, so a
    // still-ACTIVE row past its end cannot be extended.
    expect(
      opportunityActions(
        {
          status: "ACTIVE",
          saleMode: "GROUP" as const,
          extendedAt: null,
          endAt: PAST,
          decisionWindowClosesAt: null,
          fundedQuantity: 0,
        },
        NOW,
      ).canExtend,
    ).toBe(false);
  });

  // ------------------------------------------- the supplier's 24 hours

  /**
   * The window is a DATE, not a status — "EXPIRED" is terminal and an
   * extension has to be able to return the offer to ACTIVE.
   */
  const inWindow = (over: Partial<OpportunityGateInput> = {}): OpportunityGateInput => ({
    ...live("ACTIVE"),
    endAt: PAST,
    decisionWindowClosesAt: FUTURE,
    fundedQuantity: 6,
    ...over,
  });

  it("opens the extension again while the window runs", () => {
    // The case the option exists for. Refusing every ended offer refused
    // exactly it, and the API was corrected the same way.
    expect(opportunityActions(inWindow(), NOW).canExtend).toBe(true);
  });

  it("offers to close at what was reached, but only if something was", () => {
    expect(opportunityActions(inWindow(), NOW).canCloseAtReached).toBe(true);
    // Nothing sold is not a decision — the clock refunds nobody and the
    // offer simply ends. The API refuses it too.
    expect(
      opportunityActions(inWindow({ fundedQuantity: 0 }), NOW).canCloseAtReached,
    ).toBe(false);
  });

  it("shuts both the moment the window elapses", () => {
    const elapsed = opportunityActions(
      inWindow({ decisionWindowClosesAt: PAST }),
      NOW,
    );
    expect([elapsed.canCloseAtReached, elapsed.canExtend, elapsed.decisionWindowOpen]).toEqual([
      false,
      false,
      false,
    ]);
  });

  it("never opens on an offer that is still selling", () => {
    // No window column set means the offer's own end has not arrived.
    const selling = opportunityActions(live("ACTIVE"), NOW);
    expect([selling.decisionWindowOpen, selling.canCloseAtReached]).toEqual([false, false]);
  });

  it("covers all eight statuses and nothing else", () => {
    expect(SUPPLIER_OPPORTUNITY_STATUSES).toHaveLength(8);
  });

  it("gives every status a next step", () => {
    const messages = JSON.parse(read("messages/ar-SA.json")).supplier
      .opportunities.nextStep;

    for (const status of SUPPLIER_OPPORTUNITY_STATUSES) {
      const key = opportunityNextStepKey(status);
      const value = key
        .split(".")
        .reduce<unknown>((node, part) => (node as never)[part], messages);
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

  it("exposes only the five input-free actions", () => {
    const code = strip(ACTIONS);

    // Every one of them is a button and nothing else: the quantity a
    // close-at-reached takes is whatever was bought, the days an
    // extension adds are the platform's setting, and stopping a direct
    // listing asks nothing at all — it ends new sales and leaves every
    // paid order exactly where it is.
    for (const action of [
      `"publish"`,
      `"close-at-reached"`,
      `"extend"`,
      `"stop"`,
      `"delete"`,
    ]) {
      expect([action, code.includes(action)]).toEqual([action, true]);
    }
    expect(code).not.toContain("canUpdate");
  });
});

// -------------------------------------------------------------- writes

const gateAll = {
  canUpdate: false,
  canPublish: true,
  canCloseAtReached: false,
  canExtend: true,
  canDelete: true,
  canStop: false,
  decisionWindowOpen: false,
};

/**
 * The gate an offer wears when its window closed short: no publishing
 * (it is past that), no deleting (buyers are on it), and the two
 * answers the owner named — «إذا قرر أن تقفل الصفقة ويعتمدها أوك، وإذا
 * أراد أن تكتمل مئة بالمئة فعنده خيار التمديد».
 */
const gateInWindow = {
  canUpdate: false,
  canPublish: false,
  canCloseAtReached: true,
  canExtend: true,
  canDelete: false,
  canStop: false,
  decisionWindowOpen: true,
};

const LABELS = {
  publish: "نشر",
  publishPrompt: "تأكيد النشر؟",
  closeAtReached: "إقفال على ما تحقق",
  closeAtReachedPrompt: "تأكيد الإقفال؟",
  extend: "تمديد",
  extendPrompt: "تأكيد التمديد؟",
  stop: "Stop",
  stopPrompt: "Stop this listing?",
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

const { OpportunityActions } =
  await import("@/components/supplier/opportunity-actions");

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  refreshMock.mockReset();
  replaceMock.mockReset();
  fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ id: "o-1" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
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
      listHref="/ar-SA/supplier/products"
      labels={LABELS}
    />,
  );
}

describe("publish, extend and delete", () => {
  it("asks before publishing, then posts to THE LISTING ROUTE", async () => {
    renderActions();

    fireEvent.click(screen.getByText(LABELS.publish));
    expect(await screen.findByText(LABELS.publishPrompt)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText(LABELS.confirm));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [url, init] = fetchMock.mock.calls[0];
    // NOT the opportunity route. That one answers a refusal with
    // `VALIDATION_FAILED` and an operator-facing English sentence; the
    // listing route records the blocker on the row and returns its
    // CODE, so a supplier reads what to DO whether they pressed publish
    // here or on the form.
    expect(String(url)).toContain(
      "/api/v1/companies/me/listings/o-1/publish",
    );
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("asks before extending — it is allowed once and cannot be undone", async () => {
    renderActions();

    fireEvent.click(screen.getByText(LABELS.extend));
    fireEvent.click(await screen.findByText(LABELS.confirm));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "/opportunities/o-1/extend",
    );
  });

  it("navigates to the list after a delete rather than refreshing into a 404", async () => {
    renderActions();

    fireEvent.click(screen.getByText(LABELS.delete));
    fireEvent.click(await screen.findByText(LABELS.confirm));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
    expect(replaceMock).toHaveBeenCalledWith("/ar-SA/supplier/products");
  });

  it("refuses a second write while one is in flight", async () => {
    let release: (value: Response) => void = () => {};
    fetchMock.mockImplementation(
      () => new Promise<Response>((resolve) => (release = resolve)),
    );

    renderActions();
    fireEvent.click(screen.getByText(LABELS.publish));

    const confirm = await screen.findByText(LABELS.confirm);
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    expect(fetchMock).toHaveBeenCalledTimes(1);

    release(
      new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
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
        { status: 403, headers: { "content-type": "application/json" } },
      ),
    );

    renderActions();
    fireEvent.click(screen.getByText(LABELS.publish));
    fireEvent.click(await screen.findByText(LABELS.confirm));

    const alert = await screen.findByRole("alert");

    expect(
      within(alert).getByText("errors.codes.SUPPLIER_NOT_VERIFIED"),
    ).toBeInTheDocument();
    // The operator-facing English detail string must not appear.
    expect(alert.textContent).not.toContain("verified supplier");
    expect(alert.textContent).toContain("req-7");
    expect(refreshMock).not.toHaveBeenCalled();
  });

  // ------------------------------- the supplier's two answers

  it("asks before closing at what was reached, then posts to the offer", async () => {
    renderActions(gateInWindow);

    fireEvent.click(screen.getByText(LABELS.closeAtReached));
    expect(await screen.findByText(LABELS.closeAtReachedPrompt)).toBeInTheDocument();
    // The prompt names what cannot be undone before anything is sent.
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText(LABELS.confirm));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [url, init] = fetchMock.mock.calls[0];
    // THE OFFER'S OWN ROUTE — «يقرر المورد في العرض نفسه». Not the
    // listing route: there is no blocker vocabulary to translate here,
    // and nothing about a product to re-check.
    expect(String(url)).toContain("/companies/me/opportunities/o-1/close-at-reached");
    expect(init?.method).toBe("POST");
    // The quantity is whatever was bought; the only question was
    // whether to take it, and that was the button. Nothing this client
    // could send would be read.
    expect(String(init?.body ?? "")).not.toContain("quantity");
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    // It stays on the offer. Closing does not remove it — the buyers
    // are now waiting for goods described by this very page.
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("draws close before extend, and no delete beside them", () => {
    renderActions(gateInWindow);

    const buttons = screen.getAllByRole("button").map((b) => b.textContent);
    expect(buttons).toEqual([LABELS.closeAtReached, LABELS.extend]);
    // «إذا كان عليه عملية شراء يطلب المورد من الإدارة إلغاء العرض» —
    // removing an offer buyers have paid into is not the supplier's to
    // do, and a third button here would be a fourth answer to a
    // question that has three.
    expect(screen.queryByText(LABELS.delete)).toBeNull();
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
      expect(button.className).not.toContain("min-h-11");
      expect(button.className).toContain("min-h-control");
    }
  });
});

// ---------------------------------------------------------------- money

describe("money is a decimal string end to end", () => {
  it("declares the four amounts as strings on the shared contract", () => {
    const contract = readFileSync(
      join(
        ROOT,
        "..",
        "..",
        "packages",
        "types",
        "src",
        "contracts",
        "supplier-opportunity.ts",
      ),
      "utf8",
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
    expect(MONEY).not.toMatch(
      /export function formatMoney\([^)]*amount: number/,
    );
  });

  it("does no arithmetic on any amount", () => {
    // THE LIST'S CARD IS ITS OWN FILE, so the amount it renders is
    // checked where it is rendered. The page passes labels, not money.
    for (const source of [strip(ROW_CARD), strip(DETAIL)]) {
      // `Money` formats through the same module and adds the drawn
      // riyal symbol, which no formatted string can carry.
      expect(source).toContain("<Money");
    }
    for (const source of [strip(LIST), strip(ROW_CARD), strip(DETAIL)]) {
      expect(source).not.toContain("parseFloat");
      expect(source).not.toMatch(/Number\(\s*opportunity\./);
      expect(source).not.toMatch(/[Aa]mount\s*[*+\-/]\s*/);
      expect(source).not.toMatch(/reduce\(/);
    }
  });

  it("prints funded and target IN FULL, and draws the bar from those two", () => {
    // THE RULE HAS NOT MOVED: progress must not become a second source
    // of truth. What changed is that the approved reference draws a bar
    // and a percentage BESIDE the two counts — so the counts are still
    // printed in full, exactly as the server sent them, and the picture
    // is derived from them where a reader can check it against them.
    //
    // WHAT WOULD STILL BE WRONG is a percentage INSTEAD of the counts,
    // or one read off a field the server never sent.
    for (const source of [strip(LIST), strip(DETAIL)]) {
      expect(source).toContain("fundedOfTarget");
    }
    for (const source of [strip(ROW_CARD), strip(DETAIL)]) {
      // The counts are the bar's accessible value too, so a screen
      // reader hears the same two numbers rather than a percentage
      // nothing else on the screen shows.
      expect(source).toContain("aria-valuenow={opportunity.fundedQuantity}");
      expect(source).toContain("aria-valuemax={opportunity.targetQuantity}");
      // And the derivation is guarded: it divides only after checking
      // the target is above zero, so an empty offer draws an empty bar
      // rather than NaN.
      expect(source).toContain("opportunity.targetQuantity > 0");
      // ALL whitespace, not runs of it: the formatter also breaks after
      // the opening paren, so a single-space normalisation would still
      // leave «Math.min( 100».
      expect(source.replace(/\s/g, "")).toContain("Math.min(100,");
    }
  });

  it("renders the FROZEN tax breakdown and recomputes nothing", () => {
    const code = strip(DETAIL);

    // The sentence saying so is gone — a blurb under a heading, which
    // the owner banned platform-wide. WHAT IT CLAIMED IS STILL TRUE and
    // is what this test was always really about: the figures come off
    // the row as stored, and nothing here multiplies a price by a rate.
    expect(code).not.toContain("taxFrozenNotice");
    expect(code).toContain("opportunity.unitPriceExclTaxAmount");
    expect(code).toContain("opportunity.unitTaxAmount");
    expect(code).not.toMatch(/unitPriceAmount[^)]*taxRatePercent/);
  });

  it("omits every tax figure it does not have", () => {
    // Null, not zero: a zero would be a claim that no tax applies.
    //
    // IT USED TO BE ONE CARD BEHIND ONE CONDITION. The breakdown is
    // now filed with the price it breaks down, and each figure is
    // drawn only where the row holds one — the same refusal, asked
    // per figure rather than per card.
    const code = strip(DETAIL).replace(/\s+/g, " ");
    for (const guard of [
      "{exclTax ? (",
      "{tax ? (",
      "{totalValue ? (",
      "{opportunity.taxRatePercent !== null ? (",
    ]) {
      expect([guard, code.includes(guard)]).toEqual([guard, true]);
    }
  });
});

// ---------------------------------------------------------- ACTION_REQUIRED

describe("ACTION_REQUIRED is translated, with a fix for each reason", () => {
  const ar = JSON.parse(read("messages/ar-SA.json")).supplier;
  const en = JSON.parse(read("messages/en-SA.json")).supplier;

  it("translates all eleven reason codes in both locales", () => {
    // ELEVEN since LOCATION_REGION_INACTIVE joined. The city code stays
    // translated because listings blocked under the old rule still
    // carry it, and an untranslated one would show a supplier a raw
    // identifier.
    expect(SUPPLIER_OPPORTUNITY_REASON_CODES).toHaveLength(11);

    for (const code of SUPPLIER_OPPORTUNITY_REASON_CODES) {
      expect(ar.status.opportunityReason[code], code).toBeTruthy();
      expect(en.status.opportunityReason[code], code).toBeTruthy();
    }
    expect(Object.keys(ar.status.opportunityReason).sort()).toEqual(
      [...SUPPLIER_OPPORTUNITY_REASON_CODES].sort(),
    );
  });

  it("pairs every reason code with a fix", () => {
    expect(Object.keys(ar.opportunities.reasonFix).sort()).toEqual(
      [...SUPPLIER_OPPORTUNITY_REASON_CODES].sort(),
    );
    expect(Object.keys(en.opportunities.reasonFix).sort()).toEqual(
      [...SUPPLIER_OPPORTUNITY_REASON_CODES].sort(),
    );
  });

  it("says plainly when the fix is not the supplier's to make", () => {
    // TAX_RATE_NOT_CONFIGURED is a platform-side condition. Telling
    // someone to correct it would send them looking for a setting they
    // do not have.
    expect(
      en.opportunities.reasonFix.TAX_RATE_NOT_CONFIGURED.toLowerCase(),
    ).toContain("nothing for you to correct");
  });

  it("shows the reason code, never the row's operator-facing details", () => {
    const code = strip(DETAIL);

    expect(code).toContain("opportunityReason.${opportunity.reasonCode}");
    expect(code).toContain("reasonFix.${opportunity.reasonCode}");
    expect(code).not.toContain("reasonDetails");
  });

  it("has no reasonDetails on the contract at all, so there is nothing to leak", () => {
    expect([...SUPPLIER_OPPORTUNITY_DETAIL_KEYS]).not.toContain(
      "reasonDetails",
    );
    expect(SUPPLIER_DATA).not.toContain("reasonDetails");
  });
});

// ---------------------------------------------------------------- pages

describe("the list and detail pages", () => {
  it("read the closed contracts", () => {
    const code = strip(SUPPLIER_DATA);

    expect(code).toContain("SupplierOpportunitySummary[]");
    expect(code).toContain("SupplierOpportunityDetail");
    expect(code).toContain(
      'load<SupplierOpportunitySummary[]>("/companies/me/opportunities")',
    );
  });

  it("matches the contract's own key lists", () => {
    expect(SUPPLIER_OPPORTUNITY_SUMMARY_KEYS.length).toBeGreaterThan(0);
    expect([...SUPPLIER_OPPORTUNITY_DETAIL_KEYS]).toEqual(
      expect.arrayContaining([...SUPPLIER_OPPORTUNITY_SUMMARY_KEYS]),
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
    expect(code.indexOf("needsAttention.title")).toBeLessThan(
      code.indexOf("allTitle"),
    );
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
  it("offers a destination for the goods and one for the offers", async () => {
    // THERE USED TO BE TWO ITEMS — «المنتجات» and «الفرص» — listing the
    // same items with and without their selling terms, so a supplier
    // had to open both to know anything. The rule this test carried
    // stands unchanged: a destination is named only when its page
    // exists. What changed is that there is one of them.
    const { SUPPLIER_PORTAL_MAP } =
      await import("@/components/supplier/supplier-portal-nav");
    const { portalPages } = await import("@/components/portal/portal-nav");
    const pages = portalPages(SUPPLIER_PORTAL_MAP);

    // BOTH, and each named only because its page exists. They were
    // merged into one list for a while — «أضف تبويبًا مستقلًا باسم
    // عروضي بجانب منتجاتي» undoes that.
    const offers = pages.find((p) => p.key === "opportunities")!;
    expect(offers.segment).toBe("opportunities");

    const products = pages.find((p) => p.key === "products")!;
    expect(products.segment).toBe("products");
    expect(
      existsSync(join(ROOT, "app", "[locale]", "supplier", "products", "page.tsx")),
    ).toBe(true);
    expect(
      existsSync(
        join(ROOT, "app", "[locale]", "supplier", "products", "[id]", "page.tsx"),
      ),
    ).toBe(true);
  });

  it("ships identical opportunity keys in both locales", () => {
    const ar = JSON.parse(read("messages/ar-SA.json")).supplier;
    const en = JSON.parse(read("messages/en-SA.json")).supplier;

    const flatten = (value: unknown, prefix = ""): string[] =>
      typeof value !== "object" || value === null
        ? [prefix]
        : Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
            flatten(v, prefix ? `${prefix}.${k}` : k),
          );

    expect(flatten(ar.opportunities).sort()).toEqual(
      flatten(en.opportunities).sort(),
    );
    expect(Object.keys(ar.status.opportunity).sort()).toEqual(
      [...SUPPLIER_OPPORTUNITY_STATUSES].sort(),
    );
  });
});

/**
 * THE DIRECT LISTING, ON THE SUPPLIER'S OWN SCREEN.
 *
 * «نفس المنتج يمكن أن يكون له بيع مباشر نشط وعرض جماعي نشط في الوقت
 *  نفسه» — so the portal shows both kinds side by side, and every
 *  control that assumes a window has to ask which kind it is looking at
 *  before it draws anything.
 */
describe("a direct listing is gated by what it actually has", () => {
  const NOW = new Date("2026-09-15T00:00:00.000Z");

  const shelf = (status: SupplierOpportunityStatus) => ({
    status,
    saleMode: "DIRECT" as const,
    // A SHELF HAS NO WINDOW. Everything the gate derives from `endAt`
    // is about a window closing, and there is none.
    extendedAt: null,
    endAt: null,
    decisionWindowClosesAt: null,
    fundedQuantity: 0,
  });

  it("is never extendable, whatever its status", () => {
    for (const status of SUPPLIER_OPPORTUNITY_STATUSES) {
      expect([status, opportunityActions(shelf(status), NOW).canExtend]).toEqual([
        status,
        false,
      ]);
    }
  });

  it("is never treated as ended, so no decision window can open on it", () => {
    // The two things a closed window produces — «أقفل على ما وصل» and
    // «مدّد» — exist because a collective target may be missed when the
    // clock runs out. A shelf has neither a target nor a clock.
    const gate = opportunityActions(shelf("ACTIVE"), NOW);
    expect(gate.decisionWindowOpen).toBe(false);
    expect(gate.canCloseAtReached).toBe(false);
    // AND A DRAFT ONE IS STILL THE SUPPLIER'S TO CORRECT, exactly as a
    // draft offer is.
    expect(opportunityActions(shelf("DRAFT"), NOW).canUpdate).toBe(true);
  });

  it("can be stopped while it is on sale, and only then", () => {
    expect(opportunityActions(shelf("ACTIVE"), NOW).canStop).toBe(true);
    expect(opportunityActions(shelf("PAUSED"), NOW).canStop).toBe(true);
    expect(opportunityActions(shelf("DRAFT"), NOW).canStop).toBe(false);
    expect(opportunityActions(shelf("CANCELLED"), NOW).canStop).toBe(false);
  });

  it("never offers stop on a group offer — that one ends by its window or by an administrator", () => {
    for (const status of SUPPLIER_OPPORTUNITY_STATUSES) {
      const group = {
        status,
        saleMode: "GROUP" as const,
        extendedAt: null,
        endAt: "2026-10-01T00:00:00.000Z",
        decisionWindowClosesAt: null,
        fundedQuantity: 0,
      };
      expect([status, opportunityActions(group, NOW).canStop]).toEqual([status, false]);
    }
  });
});
