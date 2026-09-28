import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..", "..");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

/**
 * CANCELLING AN OFFER MUST NEVER LEAVE A BUYER WITHOUT GOODS OR MONEY.
 *
 * «العرض منشور وليس عليه أي عمليات شراء — يقدر يلغيه المورد أو الإدارة.
 *  وإذا كان عليه عملية شراء، يطلب المورد من الإدارة؛ الإدارة توقف العرض
 *  ويكون عندها زر استرداد الأموال، عند الضغط يكون مثل أن فرصة انتهت ولم
 *  تكتمل — بس يدوي، قبل أن تنتهي مدة العرض.»
 *
 * WHAT `cancel` USED TO DO, and it was the last hole in the money path:
 * it set CANCELLED and released the LIVE locks — sessions nobody had
 * paid for. Anyone who HAD paid was untouched: offer cancelled, order
 * still standing, money captured, and no refund of any kind. The buyer
 * ended with neither the goods nor the money.
 *
 * IT IS CLOSED BY REFUSING, NOT BY SILENTLY REFUNDING. An administrator
 * has to CHOOSE to move buyers' money; a cancel that quietly refunded
 * would make that choice by accident.
 */
describe("cancelling an offer never strands money", () => {
  const service = read("src/admin/opportunities/admin-opportunities.service.ts");
  const controller = read("src/admin/opportunities/admin-opportunities.controller.ts");

  it("refuses a plain cancel once anyone has paid", () => {
    const cancel = service.slice(
      service.indexOf("async cancel(id: string"),
      service.indexOf("async cancelAndRefund("),
    );
    expect(cancel).toContain("this.prisma.masterOrder.count(");
    expect(cancel).toContain("if (paidOrders > 0)");
    // AND THE REFUSAL NAMES THE WAY OUT, so an operator is not left
    // guessing what to do with an offer he has been asked to stop.
    expect(cancel).toContain("Use cancel-and-refund");
  });

  it("keeps the refund a separate act, not a flag", () => {
    // Moving buyers' money is not a variation of stopping an offer, and
    // it should be impossible to do by forgetting to set something.
    expect(controller).toContain('@Post(":id/cancel-and-refund")');
    expect(controller).toContain('@Post(":id/cancel")');
    expect(service).toContain("async cancelAndRefund(");
  });

  it("sends the money down the SAME path the clock uses", () => {
    // One route for the money, two triggers. Two implementations would
    // mean a buyer's refund depended on who ended the offer.
    expect(service).toContain("refundOfferPaymentsTx(");
    expect(service).toContain("RefundObligationReasonCode.TARGET_NOT_REACHED");
  });

  it("demands a reason, unlike the product delete", () => {
    // The owner asked for a product delete with no reason: that is an
    // operator removing his own row. This is a supplier's offer being
    // stopped and buyers' money being moved, and both of them will ask
    // why.
    expect(controller).toContain("dto.reason, ctxFrom(req, session)");
  });

  it("releases the live locks too, exactly as a plain cancel does", () => {
    // A session holding stock on an offer that no longer exists would
    // keep that stock out of everyone's reach for its whole lifetime.
    const refundCancel = service.slice(
      service.indexOf("async cancelAndRefund("),
      service.indexOf("private async requireExisting("),
    );
    expect(refundCancel).toContain("releaseActiveLocksForOpportunityTx(tx, id)");
    // AND CLEARS THE DECISION WINDOW, so the scheduler does not later
    // find an open window on an offer that is already cancelled.
    expect(refundCancel).toContain("decision_window_closes_at = NULL");
  });
});
