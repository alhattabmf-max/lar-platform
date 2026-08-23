import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Route shape and guard placement, asserted at the source level.
 *
 * Instantiating these controllers means instantiating Nest's DI, which
 * these tests do not need: what matters here is that the right guards
 * are attached, that no standalone allocation route exists, and that
 * the paths are exactly the four the batch was scoped to.
 */
const CONTROLLER = readFileSync(join(__dirname, "trader-reads.controller.ts"), "utf8");

/**
 * Comments stripped.
 *
 * The controller documents why it has no CsrfGuard and no standalone
 * allocation route, so a raw-text search finds those very words in the
 * explanation and fails on the documentation rather than the code.
 */
const CODE = CONTROLLER.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const ORDERS_SERVICE = readFileSync(join(__dirname, "orders.service.ts"), "utf8");
const MODULE = readFileSync(join(__dirname, "orders.module.ts"), "utf8");

describe("guards", () => {
  it("requires a session AND a trader on every route", () => {
    const guards = CONTROLLER.match(/@UseGuards\([^)]*\)/g) ?? [];

    expect(guards.length).toBeGreaterThan(0);
    for (const guard of guards) {
      expect(guard).toContain("SessionAuthGuard");
      expect(guard).toContain("RequireTraderGuard");
    }
  });

  it("attaches no CsrfGuard — every route here is a safe method", () => {
    // The Origin/Referer check exempts GET anyway; adding it would
    // imply these routes mutate something.
    expect(CODE).not.toContain("CsrfGuard");
    expect(CODE.match(/@Post\(/g)).toBeNull();
  });

  it("never admits a supplier or admin guard", () => {
    expect(CODE).not.toContain("RequireSupplierGuard");
    expect(CODE).not.toContain("AdminAuthGuard");
  });
});

describe("the four new routes, and no more", () => {
  it("declares exactly the scoped paths", () => {
    const routes = (CONTROLLER.match(/@Get\((?:"([^"]*)")?\)/g) ?? []).map((r) =>
      r.replace(/@Get\(|"|\)/g, "")
    );

    expect(routes.sort()).toEqual(
      [
        "orders/:masterOrderId/documents",
        "disputes",
        "replacement-obligations",
        "replacement-obligations/:id",
        // The widened order list and detail, on the pre-existing paths.
        "",
        ":id",
      ].sort()
    );
  });

  it("keeps the order routes on their original paths", () => {
    expect(CONTROLLER).toContain('@Controller("trader/orders")');
  });

  it("validates every path id as a UUID before it reaches a query", () => {
    const params = CONTROLLER.match(/@Param\([^)]*\)/g) ?? [];

    for (const param of params) expect(param).toContain("ParseUUIDPipe");
  });
});

describe("there is no standalone allocation endpoint", () => {
  it("declares no allocation route", () => {
    expect(CODE).not.toContain("order-allocations");
  });

  it("delivers allocations inline on the order detail instead", () => {
    // An allocation is only meaningful within its order; a separate
    // route would be a second ownership boundary to get right.
    expect(CONTROLLER).toContain("OrderDetail");
  });
});

describe("the replaced trader order routes", () => {
  it("removed the orphaned trader methods rather than leaving them callable", () => {
    // The shared SELECT they used carries supplierPayableAmount.
    expect(ORDERS_SERVICE).not.toMatch(/\blistForTrader\s*\(/);
    expect(ORDERS_SERVICE).not.toMatch(/\bgetForTrader\s*\(/);
  });

  it("no longer serves the SUPPLIER from that service either", () => {
    // 8E did to the supplier reads what 8D did to the trader's, and for the
    // same reason: the shared SELECT is the ADMIN's, carrying traderCompanyId
    // and a Decimal totalAmount. `SupplierOrdersService` replaced them, and
    // the legacy controller that called them was deleted with them.
    expect(ORDERS_SERVICE).not.toMatch(/\blistForSupplier\s*\(/);
    expect(ORDERS_SERVICE).not.toMatch(/\bgetForSupplier\s*\(/);
  });

  it("still serves the admin reads from that service", () => {
    // A different audience with a different boundary — those stay.
    expect(ORDERS_SERVICE).toMatch(/\blistForAdmin\s*\(/);
  });

  it("registers both new controllers and the new service", () => {
    expect(MODULE).toContain("TraderOrdersReadController");
    expect(MODULE).toContain("TraderReadsController");
    expect(MODULE).toContain("TraderOrdersService");
    expect(MODULE).not.toContain("TraderOrdersController,");
  });
});
