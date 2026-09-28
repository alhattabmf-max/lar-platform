import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PurchaseComposer } from "@/components/checkout/purchase-composer";
import { validatePurchase, stepQuantity } from "@/lib/purchase-composer";
import { apiClient } from "@/lib/api-client";
import { ApiError } from "@/lib/errors";
import messages from "@/messages/en-SA.json";

/**
 * Composing a purchase.
 *
 * The rules here are the server's: the quantity must be a multiple of
 * the share, the branch quantities must add up to it exactly, and every
 * branch must be one the API returned for this company. A form that
 * disagrees either blocks a valid purchase or lets an invalid one
 * through to a 400 the person cannot act on.
 */

const OPPORTUNITY = "55555555-5555-5555-5555-555555555555";
const SESSION = "22222222-2222-2222-2222-222222222222";
const RIYADH = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const JEDDAH = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const TABUK = "33333333-3333-4333-8333-333333333333";
const FOREIGN = "ffffffff-ffff-ffff-ffff-ffffffffffff";

const push = vi.fn();
const router = { push, refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const LOCATIONS = [
  {
    id: RIYADH,
    name: "Riyadh branch",
    regionName: "Riyadh Region",
    cityName: "Riyadh",
    shortAddress: "King Fahd Road",
  },
  {
    id: JEDDAH,
    name: "Jeddah branch",
    regionName: "Makkah Region",
    cityName: "Jeddah",
    shortAddress: "Al Andalus Street",
  },
  // A BRANCH RECORDED ON A REGION AND NO CITY, which is an ordinary
  // branch. Its line used to print only an address.
  {
    id: TABUK,
    name: "Tabuk branch",
    regionName: "Tabuk Region",
    cityName: null,
    shortAddress: "Prince Fahd Road",
  },
];

function renderComposer(overrides: Partial<React.ComponentProps<typeof PurchaseComposer>> = {}) {
  return render(
    <NextIntlClientProvider locale="en-SA" messages={messages}>
      <PurchaseComposer
        opportunityId={OPPORTUNITY}
        locale="en-SA"
        shareQuantity={4}
        unsoldQuantity={100}
        salesUnitName="Carton"
        locations={LOCATIONS}
        accountLocationsHref="/en-SA/trader/account/locations"
        {...overrides}
      />
    </NextIntlClientProvider>
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any -- the api-client
   spy is driven with hand-written resolutions; restating its generic
   signature here would test the type, not the behaviour. */
let post: any;

function sessionResponse(id = SESSION) {
  return { id, status: "LOCKED", allocations: [] };
}

beforeEach(() => {
  window.sessionStorage.clear();
  push.mockClear();
  post = vi.spyOn(apiClient, "post");
});

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const totalField = () => screen.getAllByLabelText(/^Quantity$/)[0] as HTMLInputElement;
const submitButton = () => screen.getByRole("button", { name: /Continue to purchase|Preparing/ });
const bodyOf = (call: unknown[]) => call[1] as { quantity: number; allocations: unknown[] };

describe("one branch fills itself in", () => {
  it("allocates the whole quantity without a second entry step", async () => {
    // One branch means one possible split. Making someone type it is a
    // step with no decision in it.
    const user = userEvent.setup();
    post.mockResolvedValue(sessionResponse());

    renderComposer({ locations: [LOCATIONS[0]] });

    await user.clear(totalField());
    await user.type(totalField(), "12");
    await user.click(submitButton());

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(bodyOf(post.mock.calls[0])).toEqual({
      opportunityId: OPPORTUNITY,
      quantity: 12,
      allocations: [{ companyLocationId: RIYADH, quantity: 12 }],
    });
  });

  it("keeps the branch row read-only, rather than accepting a mismatch", async () => {
    renderComposer({ locations: [LOCATIONS[0]] });

    const rows = screen.getAllByLabelText(/Branch 1 — Quantity/);
    expect((rows[0] as HTMLInputElement).readOnly).toBe(true);
  });

  it("in the compact card, the branch row IS the quantity control", async () => {
    // «الكمية ماخذة مساحة كبيرة ومكررة في مربع مواقع التسليم؛ نكتفي
    // بالحقل اللي في خانة مواقع التسليم ونغير منه الكمية.»
    //
    // THE TOTAL AND A LONE BRANCH ARE ONE NUMBER. The total already
    // mirrored DOWN into a single allocation and nothing mirrored back,
    // because the top field was always there and was authoritative.
    // Hiding it without the return mirror would have submitted whatever
    // the total happened to be when the page loaded — a money bug that
    // no assertion in this file would have caught, because every other
    // case types into the top field.
    const user = userEvent.setup();
    post.mockResolvedValue(sessionResponse());

    renderComposer({ locations: [LOCATIONS[0]], compact: true });

    // The stepper is gone; the row's own field is editable in its place.
    const row = screen.getAllByLabelText(/Branch 1 — Quantity/)[0] as HTMLInputElement;
    expect(row.readOnly).toBe(false);

    await user.clear(row);
    await user.type(row, "16");
    await user.click(submitButton());

    await waitFor(() => expect(post).toHaveBeenCalled());
    // BOTH figures follow the one field. A total of 4 with an allocation
    // of 16 is the mismatch the read-only was guarding against, and it
    // is impossible here because they are the same state.
    expect(bodyOf(post.mock.calls[0])).toEqual({
      opportunityId: OPPORTUNITY,
      quantity: 16,
      allocations: [{ companyLocationId: RIYADH, quantity: 16 }],
    });
  });

  it("keeps the top field, and the read-only row, when it is NOT compact", () => {
    // The compact form is one of three cards on the buyer's detail
    // page. Standing alone, the composer is the whole screen and keeps
    // both controls — with the row read-only, as it always was.
    renderComposer({ locations: [LOCATIONS[0]] });

    expect((screen.getAllByLabelText(/Branch 1 — Quantity/)[0] as HTMLInputElement).readOnly).toBe(
      true,
    );
    expect(totalField()).toBeInTheDocument();
  });

  it("offers no remove button when only one row exists", () => {
    renderComposer({ locations: [LOCATIONS[0]] });
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
  });
});

describe("several branches split the quantity", () => {
  it("sends each branch's own quantity", async () => {
    const user = userEvent.setup();
    post.mockResolvedValue(sessionResponse());

    renderComposer();

    await user.clear(totalField());
    await user.type(totalField(), "12");

    await user.click(screen.getByRole("button", { name: "Add another branch" }));

    const rowOne = screen.getByLabelText("Branch 1 — Quantity");
    const rowTwo = screen.getByLabelText("Branch 2 — Quantity");
    await user.clear(rowOne);
    await user.type(rowOne, "8");
    await user.type(rowTwo, "4");

    await user.click(submitButton());

    await waitFor(() => expect(post).toHaveBeenCalled());
    const body = bodyOf(post.mock.calls[0]);
    expect(body.quantity).toBe(12);
    expect(body.allocations).toEqual([
      { companyLocationId: RIYADH, quantity: 8 },
      { companyLocationId: JEDDAH, quantity: 4 },
    ]);
  });

  it("defaults a new row to a branch not already chosen", async () => {
    const user = userEvent.setup();
    renderComposer();

    await user.click(screen.getByRole("button", { name: "Add another branch" }));

    const selects = screen.getAllByLabelText("Branch") as HTMLSelectElement[];
    expect(selects[0].value).toBe(RIYADH);
    expect(selects[1].value).toBe(JEDDAH);
  });

  it("offers no add button once every branch is in use", async () => {
    const user = userEvent.setup();
    renderComposer();

    // Three branches, so two more rows exhaust the list.
    await user.click(screen.getByRole("button", { name: "Add another branch" }));
    await user.click(screen.getByRole("button", { name: "Add another branch" }));

    expect(screen.queryByRole("button", { name: "Add another branch" })).toBeNull();
  });

  it("removes a row without touching the others", async () => {
    const user = userEvent.setup();
    renderComposer();

    await user.click(screen.getByRole("button", { name: "Add another branch" }));
    await user.click(screen.getAllByRole("button", { name: "Remove" })[1]);

    expect(screen.getAllByLabelText("Branch")).toHaveLength(1);
  });
});

describe("the split must add up exactly", () => {
  it("reports a mismatch and sends nothing", async () => {
    const user = userEvent.setup();
    renderComposer();

    await user.clear(totalField());
    await user.type(totalField(), "12");
    await user.click(screen.getByRole("button", { name: "Add another branch" }));

    const rowOne = screen.getByLabelText("Branch 1 — Quantity");
    await user.clear(rowOne);
    await user.type(rowOne, "4");
    await user.type(screen.getByLabelText("Branch 2 — Quantity"), "4");

    await user.click(submitButton());

    expect(screen.getByRole("alert").textContent).toContain("do not add up");
    expect(post).not.toHaveBeenCalled();
  });

  it("re-checks the split when the total changes", async () => {
    // Nothing is redistributed silently: changing the total re-opens
    // the split rather than rewriting someone's branch quantities.
    const user = userEvent.setup();
    renderComposer();

    await user.click(screen.getByRole("button", { name: "Add another branch" }));
    await user.type(screen.getByLabelText("Branch 2 — Quantity"), "4");

    // 4 + 4 = 8 matches the default total of 8… then the total moves.
    await user.clear(totalField());
    await user.type(totalField(), "12");
    await user.click(submitButton());

    expect(screen.getByRole("alert").textContent).toContain("do not add up");
    expect(post).not.toHaveBeenCalled();
  });
});

describe("quantity rules", () => {
  it("rejects 5001 when the step is 5000", () => {
    // Reported, never rounded. Either direction changes what was asked
    // for, and the person would find out at the payment screen.
    const issues = validatePurchase({
      quantity: 5001,
      allocations: [{ companyLocationId: RIYADH, quantity: 5001 }],
      shareQuantity: 5000,
      unsoldQuantity: 100000,
      selectableIds: [RIYADH],
    });

    expect(issues.map((i) => i.code)).toContain("QUANTITY_NOT_MULTIPLE");
    expect(issues[0].values).toEqual({ step: 5000 });
  });

  it("accepts an exact multiple", () => {
    expect(
      validatePurchase({
        quantity: 10000,
        allocations: [{ companyLocationId: RIYADH, quantity: 10000 }],
        shareQuantity: 5000,
        unsoldQuantity: 100000,
        selectableIds: [RIYADH],
      })
    ).toEqual([]);
  });

  it("rejects a quantity above the unsold amount", () => {
    const issues = validatePurchase({
      quantity: 200,
      allocations: [{ companyLocationId: RIYADH, quantity: 200 }],
      shareQuantity: 4,
      unsoldQuantity: 100,
      selectableIds: [RIYADH],
    });

    expect(issues.map((i) => i.code)).toContain("QUANTITY_ABOVE_UNSOLD");
  });

  it("rejects zero, negatives and fractions", () => {
    const base = { shareQuantity: 4, unsoldQuantity: 100, selectableIds: [RIYADH] };

    for (const [quantity, code] of [
      [0, "QUANTITY_NOT_POSITIVE"],
      [-4, "QUANTITY_NOT_POSITIVE"],
      [2.5, "QUANTITY_NOT_INTEGER"],
    ] as const) {
      const issues = validatePurchase({
        ...base,
        quantity,
        allocations: [{ companyLocationId: RIYADH, quantity: 4 }],
      });
      expect([quantity, issues.map((i) => i.code)]).toEqual([
        quantity,
        expect.arrayContaining([code]),
      ]);
    }
  });

  it("accepts only digits from the keyboard", async () => {
    // A count has no decimal part, and letting one in produces a value
    // the server rejects with no explanation the person can act on.
    //
    // The rejected keystrokes leave the value untouched rather than
    // discarding what came after them, so typing "1a2.5" yields "125":
    // the letter and the dot never land, the digits do. What matters is
    // that nothing non-numeric survives.
    const user = userEvent.setup();
    renderComposer();

    await user.clear(totalField());
    await user.type(totalField(), "1a2.5");

    expect(totalField().value).toMatch(/^\d+$/);
    expect(totalField().value).not.toContain("a");
    expect(totalField().value).not.toContain(".");
  });

  it("steps by the share quantity, never below one step", () => {
    expect(stepQuantity(8, 4, 1)).toBe(12);
    expect(stepQuantity(8, 4, -1)).toBe(4);
    expect(stepQuantity(4, 4, -1)).toBe(4);
    expect(stepQuantity(null, 4, 1)).toBe(4);
    // A partial value snaps to a valid one in the direction pressed.
    expect(stepQuantity(5, 4, 1)).toBe(8);
    expect(stepQuantity(5, 4, -1)).toBe(4);
  });

  it("labels the step buttons with the amount they move by", () => {
    renderComposer();
    expect(screen.getByRole("button", { name: "Increase the quantity by 4" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Decrease the quantity by 4" })).toBeTruthy();
  });
});

describe("branch rules", () => {
  it("rejects a duplicated branch", () => {
    // Two rows for one branch is ambiguous, not additive.
    const issues = validatePurchase({
      quantity: 8,
      allocations: [
        { companyLocationId: RIYADH, quantity: 4 },
        { companyLocationId: RIYADH, quantity: 4 },
      ],
      shareQuantity: 4,
      unsoldQuantity: 100,
      selectableIds: [RIYADH, JEDDAH],
    });

    expect(issues.map((i) => i.code)).toContain("ALLOCATION_DUPLICATE");
  });

  it("rejects a branch outside the list the API returned", () => {
    const issues = validatePurchase({
      quantity: 8,
      allocations: [{ companyLocationId: FOREIGN, quantity: 8 }],
      shareQuantity: 4,
      unsoldQuantity: 100,
      selectableIds: [RIYADH, JEDDAH],
    });

    expect(issues.map((i) => i.code)).toContain("ALLOCATION_UNKNOWN_LOCATION");
  });

  it("offers no way to type a branch id at all", () => {
    // The list comes from /companies/me/locations, which the API scopes
    // to this company and filters to active rows — so the list IS the
    // eligibility rule, and a select is the only way in.
    renderComposer();

    const selects = screen.getAllByLabelText("Branch") as HTMLSelectElement[];
    const offered = [...selects[0].options].map((o) => o.value);

    expect(offered).toEqual([RIYADH, JEDDAH, TABUK]);
    expect(offered).not.toContain(FOREIGN);
    expect(screen.queryByLabelText(/location id/i)).toBeNull();
  });

  it("rejects a zero or negative branch quantity", () => {
    for (const quantity of [0, -4]) {
      const issues = validatePurchase({
        quantity: 8,
        allocations: [
          { companyLocationId: RIYADH, quantity },
          { companyLocationId: JEDDAH, quantity: 8 },
        ],
        shareQuantity: 4,
        unsoldQuantity: 100,
        selectableIds: [RIYADH, JEDDAH],
      });
      expect([quantity, issues.map((i) => i.code)]).toEqual([
        quantity,
        expect.arrayContaining(["ALLOCATION_NOT_POSITIVE"]),
      ]);
    }
  });

  it("shows the branch name, city and short address — and no coordinate", () => {
    renderComposer();

    expect(
      screen.getByText(/Delivery region: Riyadh Region — Riyadh · King Fahd Road/),
    ).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/24\.7|46\.6|latitude|longitude/i);
  });

  /**
   * A BRANCH RECORDED ON A REGION AND NO CITY still says where it is.
   * The line used to show the city alone, so such a branch printed only
   * its address — and two branches on the same street would have been
   * indistinguishable.
   */
  it("names the region for a branch that has no city", async () => {
    const user = userEvent.setup();
    renderComposer();

    await user.click(screen.getByRole("button", { name: "Add another branch" }));
    const selects = screen.getAllByLabelText("Branch") as HTMLSelectElement[];
    await user.selectOptions(selects[1], TABUK);

    expect(
      screen.getByText(/Delivery region: Tabuk Region · Prince Fahd Road/),
    ).toBeTruthy();
  });

  it("calls it the DELIVERY region, not the shipping origin", () => {
    // The marketplace filter is the supplier's origin. These are the
    // trader's own branches.
    expect(messages.trader.compose.regionLabel).toBe("Delivery region");
    expect(messages.marketplace.card.city).toBe("Ships from");
  });
});

describe("a trader with no branches", () => {
  it("explains why, and links to where they are added", () => {
    renderComposer({ locations: [] });

    expect(screen.getByText("No branches registered")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "View delivery locations" }).getAttribute("href")
    ).toBe("/en-SA/trader/account/locations");
  });

  it("shows no disabled pay button with no explanation", () => {
    renderComposer({ locations: [] });

    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("submitting", () => {
  it("navigates using the id the SERVER returned", async () => {
    // Never a locally-remembered one: a replayed retry returns the
    // original session, and navigating to a remembered id would land on
    // the wrong one.
    const user = userEvent.setup();
    post.mockResolvedValue(sessionResponse("99999999-9999-9999-9999-999999999999"));

    renderComposer({ locations: [LOCATIONS[0]] });
    await user.click(submitButton());

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        "/en-SA/trader/checkout/99999999-9999-9999-9999-999999999999"
      )
    );
  });

  it("makes ONE request on a double click", async () => {
    const user = userEvent.setup();
    let resolve: ((v: unknown) => void) | undefined;
    post.mockImplementation(() => new Promise((r) => { resolve = r; }));

    renderComposer({ locations: [LOCATIONS[0]] });

    const button = submitButton();
    await user.click(button);
    await user.click(button);

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    resolve?.(sessionResponse());
  });

  it("shows a loading state and disables the button", async () => {
    const user = userEvent.setup();
    let resolve: ((v: unknown) => void) | undefined;
    post.mockImplementation(() => new Promise((r) => { resolve = r; }));

    renderComposer({ locations: [LOCATIONS[0]] });
    await user.click(submitButton());

    await waitFor(() => expect(screen.getByRole("button", { name: "Preparing…" })).toBeTruthy());
    expect((screen.getByRole("button", { name: "Preparing…" }) as HTMLButtonElement).disabled).toBe(
      true
    );

    // Settled before leaving. `createCheckoutSession` holds in-flight
    // operations in module state keyed by the intent, so a request left
    // pending forever is handed to the next test composing the same
    // purchase — which then waits on it and never sees its own result.
    resolve?.(sessionResponse());
    await waitFor(() => expect(push).toHaveBeenCalled());
  });

  it("keeps the values AND the key after an unknown failure", async () => {
    // The request may have reached the server. Clearing the form would
    // make someone re-enter a purchase they already described, and
    // dropping the key would turn the retry into a second session.
    const user = userEvent.setup();
    post.mockRejectedValue(new TypeError("fetch failed"));

    renderComposer({ locations: [LOCATIONS[0]] });

    await user.clear(totalField());
    await user.type(totalField(), "12");
    await user.click(submitButton());

    await waitFor(() => expect(screen.getByRole("alert").textContent).not.toBe(""));
    expect(totalField().value).toBe("12");
    expect(Object.keys(window.sessionStorage)).toHaveLength(1);
  });

  it("keeps the values after a validation failure too", async () => {
    const user = userEvent.setup();
    post.mockRejectedValue(
      new ApiError({
        kind: "validation",
        status: 400,
        code: "VALIDATION_FAILED" as never,
        requestId: "req-1",
        message: "rejected",
      })
    );

    renderComposer({ locations: [LOCATIONS[0]] });

    await user.clear(totalField());
    await user.type(totalField(), "12");
    await user.click(submitButton());

    await waitFor(() => expect(screen.getByRole("alert").textContent).not.toBe(""));
    expect(totalField().value).toBe("12");
    // The key IS released: the server rejected the request itself and
    // its transaction rolled back, so there is nothing to replay.
    expect(Object.keys(window.sessionStorage)).toHaveLength(0);
  });

  it("shows a translated message and a request id, never the API's own text", async () => {
    const user = userEvent.setup();
    post.mockRejectedValue(
      new ApiError({
        kind: "validation",
        status: 400,
        code: "VALIDATION_FAILED" as never,
        requestId: "req-abc",
        message: "internal developer string",
      })
    );

    renderComposer({ locations: [LOCATIONS[0]] });
    await user.click(submitButton());

    // Waits for the CONTENT, not the element: the live region is
    // rendered up front and empty, because a region added at the moment
    // of the announcement is often not announced at all.
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("req-abc"));

    expect(screen.getByRole("alert").textContent).not.toContain("internal developer string");
  });
});

describe("nothing here is authoritative about money", () => {
  const SOURCE = readFileSync(
    join(__dirname, "..", "components", "checkout", "purchase-composer.tsx"),
    "utf8"
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("computes no shipping, tax or total", () => {
    // Shipping depends on the tariff tier per destination and tax on
    // the frozen opportunity; both are computed into quote_snapshots.
    // A figure calculated here would be a second source of truth.
    for (const term of ["formatMoney", "shipping", "Tax", "grandTotal", "unitPrice"]) {
      expect([term, SOURCE.includes(term)]).toEqual([term, false]);
    }
  });

  it("invents no estimate, because no endpoint gives one", () => {
    expect(SOURCE).not.toMatch(/estimate/i);
  });

  it("says plainly that the totals come from the server later", () => {
    expect(SOURCE).toContain("totalsComeLater");
    expect(messages.trader.compose.totalsComeLater).toMatch(/calculated by the server/i);
  });

  it("never presents the unsold figure as a reservation", () => {
    expect(messages.trader.compose.availabilityCaveat).toMatch(/not a reservation/i);
    expect(messages.trader.compose.availabilityCaveat).toMatch(/confirmed by the server/i);
  });
});

describe("accessibility", () => {
  it("labels every control", () => {
    renderComposer();

    expect(screen.getAllByLabelText(/^Quantity$/).length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Branch")).toBeTruthy();
    expect(screen.getByRole("form", { name: "Choose a quantity and continue" })).toBeTruthy();
  });

  it("announces errors on a live region", async () => {
    const user = userEvent.setup();
    renderComposer();

    await user.clear(totalField());
    await user.click(submitButton());

    const alert = screen.getByRole("alert");
    expect(alert.getAttribute("aria-live")).toBe("assertive");
  });

  it("moves focus to the first thing that is wrong", async () => {
    // A form that announces an error and leaves the cursor where it was
    // makes someone hunt for it.
    const user = userEvent.setup();
    renderComposer();

    await user.clear(totalField());
    await user.click(submitButton());

    expect(document.activeElement).toBe(totalField());
  });

  it("marks the offending field invalid", async () => {
    const user = userEvent.setup();
    renderComposer();

    await user.clear(totalField());
    await user.click(submitButton());

    expect(totalField().getAttribute("aria-invalid")).toBe("true");
  });

  it("reports every problem at once, not one at a time", () => {
    // Revealing one error at a time turns a two-field mistake into two
    // round trips.
    const issues = validatePurchase({
      quantity: 5001,
      allocations: [{ companyLocationId: FOREIGN, quantity: 5001 }],
      shareQuantity: 5000,
      unsoldQuantity: 100,
      selectableIds: [RIYADH],
    });

    expect(issues.length).toBeGreaterThan(1);
  });
});
