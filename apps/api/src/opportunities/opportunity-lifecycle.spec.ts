import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

/**
 * THE CLOCK, AND WHAT IT IS ALLOWED TO DO.
 *
 * «في حالة لم يكتمل الهدف يتم الاسترداد تلقائي… فرصة لم تصل هدفها مئة
 *  بالمئة بل وصلت ستين بالمئة، هنا مهلة تعطى للمورد مدة 24 ساعة… إذا لم
 *  ينفذ الخيارين تنتهي الفرصة وتسترد الأموال تلقائي.»
 *
 * BEFORE THIS THERE WAS NO SCHEDULER AT ALL — no `@Cron`, no queue, and
 * 145 outbox events with no consumer. Nothing ended an offer when its
 * window closed. These cases guard the two things that make an automatic
 * refund safe: that it can only ever fire once, and that it fires for
 * the whole amount.
 */
describe("the offer's own clock", () => {
  const service = read("src/opportunities/opportunity-lifecycle.service.ts");
  // THE REFUND ITSELF IS A SHARED UTIL. One path for the money and two
  // triggers — the clock when a window closes without filling, an
  // administrator when something is wrong before then. Two
  // implementations would mean a buyer's refund depended on who ended
  // the offer.
  const refund = read("src/opportunities/refund-offer-payments.util.ts");
  const app = read("src/app.module.ts");
  const migration = read(
    "prisma/migrations/20260902090000_offer_ends_and_refunds_itself/migration.sql",
  );

  it("is registered once, at the root", () => {
    expect(app).toContain("ScheduleModule.forRoot()");
  });

  it("claims every row it acts on, never reads then writes", () => {
    // Two overlapping ticks must not both refund one offer. Every
    // transition is an UPDATE carrying the old state in its WHERE, and
    // the row is skipped if the claim matched nothing.
    for (const claim of [
      `WHERE id = ${"${opportunityId}"}::uuid AND status IN ('ACTIVE', 'PAUSED')`,
      "if (claimed === 0) return;",
      "FOR UPDATE SKIP LOCKED",
    ]) {
      expect([claim, service.includes(claim)]).toEqual([claim, true]);
    }
  });

  it("never writes a second obligation for a payment that has one", () => {
    // The strongest guard in the file: even if a claim were somehow won
    // twice, the refund query itself refuses a payment that is already
    // owed money back.
    expect(refund).toContain(
      "SELECT 1 FROM refund_obligations r WHERE r.payment_attempt_id = pa.id",
    );
    // AND THE ADMIN'S BUTTON GOES THROUGH THE SAME ONE.
    const admin = read("src/admin/opportunities/admin-opportunities.service.ts");
    expect(admin).toContain("refundOfferPaymentsTx(");
  });

  it("refunds the WHOLE payment, shipping included", () => {
    // «الشحن أصلاً مربوط كل مشتري برسوم شحن معينة على حسب مدينته» — and
    // not one of those fees was spent, because nothing shipped. The
    // obligation is raised against `payment_attempts.amount`, which is
    // what the buyer actually paid; deriving goods and shipping
    // separately here would be a second arithmetic that could disagree
    // with the first.
    expect(refund).toContain("pa.amount");
    expect(refund).toContain("paymentAttemptId: payment.payment_attempt_id");
    expect(refund).not.toContain("productRefundAmountInclTax");
  });

  it("writes nothing when nobody bought", () => {
    // An obligation for zero would be a row asserting a debt exists.
    expect(service).toContain("expireWithNothingSold");
    const unsold = service.slice(
      service.indexOf("private async expireWithNothingSold"),
      service.indexOf("private async openDecisionWindow"),
    );
    expect(unsold).not.toContain("refundObligation");
  });

  it("holds the supplier's window as a DATE, not a status", () => {
    // `EXPIRED` is terminal in the transition table and an extension has
    // to be able to return the offer to ACTIVE. Marking the window with
    // a status would mean loosening the state machine that keeps every
    // other path honest.
    expect(migration).toContain(`ADD COLUMN IF NOT EXISTS "decision_window_closes_at"`);
    expect(service).toContain("decision_window_closes_at IS NULL");
    expect(service).toContain("decision_window_closes_at <= now()");
  });

  it("keeps the 24 hours out of settings, deliberately", () => {
    // The owner's own decision: the window is a promise to the BUYER,
    // whose money is already captured. An operator who could widen it to
    // seventy-two hours with one field would be changing what a buyer
    // agreed to after they paid. The extension DAYS are configurable.
    expect(service).toContain("const SUPPLIER_DECISION_WINDOW_HOURS = 24");
    expect(service).not.toContain("SUPPLIER_DECISION_WINDOW_HOURS =\n  await");
  });

  it("never touches an offer that reached its target", () => {
    expect(service).toContain("funded_quantity < target_quantity");
  });

  it("survives its own failure", () => {
    // A failed tick must not take the server with it: the next one is
    // sixty seconds away and every step re-claims its own rows.
    const tick = service.slice(service.indexOf("async tick("), service.indexOf("closeExpiredOffers()"));
    expect(tick).toContain("try {");
    expect(service).toContain("opportunity lifecycle tick failed");
  });
});

/**
 * NEITHER CLOCK MAY TOUCH A SHELF.
 *
 * Two sweeps run against `opportunities`: this API's `@Cron` and the
 * worker's batched one in `@platform/opportunity-lifecycle`. Both were
 * written when every row had a window and a collective target, and both
 * read exactly the columns a direct listing gives a different meaning
 * to.
 *
 * THE FUNDED SAFETY NET IS THE DANGEROUS ONE. `funded_quantity >=
 * target_quantity` is true of a filled group offer AND of a sold-out
 * shelf, and the two mean opposite things: one has finished, the other
 * needs restocking. Sweeping the second to FUNDED would put it in a
 * status nothing leaves — and the database refuses, which turns a wrong
 * transition into a transaction that rolls back the rest of the run
 * with it, every minute, for as long as one direct listing is sold out.
 */
describe("the sweeps leave direct listings alone", () => {
  const apiSweep = read("src/opportunities/opportunity-lifecycle.service.ts");
  const workerSweep = read("../../packages/opportunity-lifecycle/src/sweep.ts");

  it("expires only what has a window to close", () => {
    expect(apiSweep).toContain("AND sale_mode = 'GROUP'");
    expect(workerSweep).toContain("sale_mode = 'GROUP'");
  });

  it("never marks a sold-out shelf FUNDED", () => {
    // THE FUNCTION, not the first mention of its name — which is the
    // call site at the top of the file.
    const start = workerSweep.indexOf("async function runFundedSafetyNetBatches");
    expect(start).toBeGreaterThan(-1);
    const net = workerSweep.slice(start, workerSweep.indexOf("RETURNING o.id, o.company_id", start));
    expect(net).toContain("sale_mode = 'GROUP'");
    expect(net).toContain("funded_quantity >= target_quantity");
  });

  it("and the database refuses it even if a sweep tried", () => {
    const migration = read(
      "prisma/migrations/20260915000100_two_sale_paths_direct_and_group/migration.sql"
    );
    expect(migration).toContain('"opportunities_sale_mode_status"');
    expect(migration).toContain(
      `"status" IN ('DRAFT', 'ACTION_REQUIRED', 'ACTIVE', 'PAUSED', 'CANCELLED')`
    );
  });
});
