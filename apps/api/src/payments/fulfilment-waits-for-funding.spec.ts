import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

/**
 * NOTHING IS FULFILLED UNTIL THE OFFER REACHES ITS TARGET.
 *
 * «المشترون يشترون حصصهم، إذا اكتمل الهدف يتم إرسال الطلبات للمورد… في
 *  حالة لم يكتمل الهدف يتم الاسترداد تلقائي.»
 * «العرض مثلاً سبعة أيام، اكتمل الهدف في ثلاثة أيام أو يوم — المهم أنه
 *  اكتمل قبل نهاية العرض، خلاص يقفل تلقائي ويبدأ التجهيز من بداية إقفال
 *  العرض.»
 *
 * WHAT THE PLATFORM USED TO SAY ABOUT ITSELF, in
 * `packages/domain/src/opportunity-transitions.ts`: "targetQuantity is a
 * supply CAP … never a collective goal that must be reached before any
 * order proceeds — every paid order is created and sent for fulfillment
 * immediately". That is the opposite of a group buy, and it had three
 * consequences that were all visible on screen:
 *
 *   1. A clock started at PAYMENT, so a supplier whose offer stood at
 *      20% was reported overdue on the admin dashboard, his own
 *      dashboard, and the late list.
 *   2. The first buyer could be shipped a wholesale price for a volume
 *      that never materialised.
 *   3. A collective refund became impossible the moment anything was
 *      delivered or paid out — which is why no "target not reached"
 *      path was ever built.
 *
 * These cases are what stop the immediate path from coming back.
 */
describe("fulfilment waits for funding", () => {
  const webhook = read("src/payments/payment-webhook.service.ts");
  // THE RELEASE IS A SHARED UTIL, NOT A METHOD ON THE WEBHOOK. An
  // offer closes two ways — it fills on its own, or the supplier
  // accepts what it reached inside his 24 hours — and both must date
  // the work identically. Written twice, the two would drift and a
  // buyer's deadline would depend on which door the offer left by.
  const release = read("src/opportunities/release-funded-allocations.util.ts");
  const migration = read(
    "prisma/migrations/20260902080000_fulfilment_waits_for_funding/migration.sql",
  );

  it("creates every GROUP allocation waiting, with no date to be late against", () => {
    /**
     * THE RULE IS ABOUT THE GROUP OFFER, and it always was. «إذا اكتمل
     * الهدف يتم إرسال الطلبات للمورد» — the wait exists because a
     * collective target may not be reached, and until it is, nobody may
     * begin work and nobody can be late.
     *
     * A DIRECT SALE HAS NO TARGET TO REACH. «عند نجاح الدفع… ينتقل
     * الطلب مباشرة إلى AWAITING_PREPARATION»: the goods are on a shelf,
     * the buyer paid for them, and the supplier's clock starts at that
     * payment — which is exactly what the days were frozen against.
     *
     * So the branch is asserted as a BRANCH: the waiting state and the
     * null date still belong to the group path, and the immediate date
     * may exist only on the direct one. The three failures in the
     * header above were all about a clock started at payment for work
     * NOBODY WAS PERMITTED TO BEGIN — which is not the direct case.
     */
    expect(webhook).toContain('isDirect ? "AWAITING_PREPARATION" : "AWAITING_FUNDING"');
    expect(webhook).toContain("preparationDueAt: isDirect");
    expect(webhook).toContain("      : null,");

    // AND THE DIRECT DATE IS GUARDED BY THE MODE, never stamped
    // unconditionally — `capturedAt + days` for every allocation is the
    // exact line this whole file replaced.
    const stampSite = webhook.indexOf("capturedAt.getTime() +");
    expect(stampSite).toBeGreaterThan(-1);
    expect(webhook.slice(stampSite - 400, stampSite)).toContain("isDirect");

    // AND THE MODE IS READ UNDER THE OFFER'S OWN ROW LOCK, not from a
    // second query that could disagree with the funding arithmetic.
    expect(webhook).toContain("SELECT id, sale_mode, status, target_quantity, funded_quantity");
    expect(webhook).toContain("FOR UPDATE");
  });

  it("never lets a DIRECT listing reach FUNDED", () => {
    // FUNDED is terminal in OPPORTUNITY_TRANSITIONS and means a
    // collective target was reached. A shelf that sold its last unit is
    // empty, not finished — it stays ACTIVE and is buyable again the
    // moment it is restocked.
    expect(webhook).toContain("if (!isDirect && opportunity.status === \"ACTIVE\")");

    const saleModeMigration = read(
      "prisma/migrations/20260915000100_two_sale_paths_direct_and_group/migration.sql",
    );
    expect(saleModeMigration).toContain('"opportunities_sale_mode_status"');
    expect(saleModeMigration).toContain(
      `"status" IN ('DRAFT', 'ACTION_REQUIRED', 'ACTIVE', 'PAUSED', 'CANCELLED')`,
    );
  });

  it("releases every share of the offer at the moment it closes", () => {
    // Not just the payment that closed it: a buyer who paid on day one
    // and one who paid on day three are owed the same window, because
    // the supplier could not lawfully begin either until now.
    expect(webhook).toContain("releaseFundedAllocationsTx");
    expect(webhook).toContain("if (fundingClosed)");
    expect(release).toContain('status: "AWAITING_FUNDING"');
    expect(release).toContain("masterOrder: { opportunityId }");

    // AND THE SUPPLIER'S OWN CLOSE CALLS THE SAME ONE.
    const offers = read("src/opportunities/opportunities.service.ts");
    expect(offers).toContain("releaseFundedAllocationsTx(tx, id, closedAt)");
  });

  it("dates each share from the offer's close, using its OWN frozen days", () => {
    // `expectedPreparationDays` was frozen on the row when that buyer
    // paid; re-reading it from the opportunity would pick up an
    // extension or an edit made since.
    expect(release).toContain("allocation.expectedPreparationDays * 24 * 3600_000");
    expect(release).toContain("closedAt.getTime()");
  });

  it("has the database refuse a date it was not asked for", () => {
    // The guard lists every legal transition by hand. It named
    // `preparation_due_at` frozen FROM BIRTH, which made stamping it at
    // close impossible; now it is frozen ONCE SET, and the one new
    // transition may fill it only while it is still NULL.
    expect(migration).toContain(
      `OR (OLD."preparation_due_at" IS NOT NULL`,
    );
    expect(migration).toContain(
      `IF OLD."status" = 'AWAITING_FUNDING' AND NEW."status" = 'AWAITING_PREPARATION'`,
    );
    expect(migration).toContain(`OLD."preparation_due_at" IS NULL`);
    // AND NOTHING ELSE MAY MOVE WITH IT, so the transition cannot be
    // used to skip a fulfilment step.
    expect(migration).toContain(
      `AND NEW."shipped_at" IS NOT DISTINCT FROM OLD."shipped_at"`,
    );
  });

  it("leaves a share with no date incapable of being late", () => {
    for (const file of [
      "src/orders/supplier-orders.service.ts",
      "src/orders/trader-orders.service.ts",
    ]) {
      const code = read(file);
      expect([file, code.includes("preparationDueAt === null) return false")]).toEqual([
        file,
        true,
      ]);
    }
  });

  it("offers the supplier no action on a waiting share", () => {
    // `SUPPLIER_ALLOCATION_ACTIONS` maps a status to the one thing a
    // supplier may do from it. A waiting share appears in no row of it,
    // so the screen can offer nothing — which is the point.
    const contract = read("../../packages/types/src/contracts/supplier-order.ts");
    const actions = contract.slice(
      contract.indexOf("export const SUPPLIER_ALLOCATION_ACTIONS"),
      contract.indexOf("} as const satisfies"),
    );
    expect(actions).not.toContain("AWAITING_FUNDING");
  });
});
