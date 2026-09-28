import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

/**
 * THE SUPPLIER'S TWO ANSWERS, AND THE WINDOW THEY LIVE IN.
 *
 * «فرصة لم تصل هدفها مئة بالمئة، بل وصلت ستين بالمئة… هنا يكون فيه مهلة
 *  تعطى للمورد مدة 24 ساعة: إذا قرر أن تقفل الصفقة ويعتمدها أوك، وإذا
 *  أراد أن تكتمل مئة بالمئة فعنده خيار التمديد… إذا لم ينفذ الخيارين
 *  تنتهي الفرصة وتسترد الأموال تلقائي.»
 * «يقرر المورد في العرض نفسه.»
 *
 * HALF OF THIS ALREADY EXISTED. `extend` has been there since the offer
 * had a window at all — once only, by the days an operator sets — and it
 * refused every offer whose `end_at` had passed. That refusal covered
 * the one case the feature is for: the window opens precisely BECAUSE
 * the offer ended without filling.
 */
describe("the supplier's decision window", () => {
  const service = read("src/opportunities/opportunities.service.ts");
  const controller = read("src/opportunities/opportunities.controller.ts");

  it("gives the supplier both answers on the offer's own screen", () => {
    // «يقرر المورد في العرض نفسه» — two routes on the offer, not a
    // separate inbox to visit.
    expect(controller).toContain('@Post(":id/close-at-reached")');
    expect(controller).toContain('@Post(":id/extend")');
  });

  it("lets an extension work INSIDE the window, which is its whole point", () => {
    // It used to refuse any offer past `end_at`. The window opens
    // because the offer ended without filling, so that refusal covered
    // exactly the case the option exists for.
    expect(service).toContain("const decisionWindowOpen =");
    expect(service).toContain("existing.decisionWindowClosesAt > new Date()");
    // `endAt!` — the offer is a GROUP one by the time this line runs
    // (`assertGroupOnly` is the first thing `extend` does), and only a
    // GROUP offer has a window at all.
    expect(service).toContain("existing.endAt! <= new Date() && !decisionWindowOpen");
  });

  it("still refuses a second extension", () => {
    // One extension, by the days the operator sets. Two would let an
    // offer live for ever on a buyer's captured money.
    expect(service).toContain("extended_at IS NULL");
    expect(service).toContain("has already been extended once");
  });

  it("closes only while the window is genuinely open", () => {
    // Before it there is nothing to decide — the offer is still selling.
    // After it the money is already going back and there is nothing left
    // to close.
    const close = service.slice(
      service.indexOf("async closeAtReached("),
      service.indexOf("async extend("),
    );
    expect(close).toContain("decisionWindowClosesAt === null");
    expect(close).toContain("decisionWindowClosesAt <= new Date()");
    expect(close).toContain("no open decision window");
  });

  it("claims the window rather than reading it, because the clock is running too", () => {
    // The scheduler ticks every minute and may be closing this same
    // window as the supplier presses. Whichever writes first wins; the
    // loser does nothing rather than acting on a state that has moved.
    const close = service.slice(
      service.indexOf("async closeAtReached("),
      service.indexOf("async extend("),
    );
    expect(close).toContain("decision_window_closes_at > now()");
    expect(close).toContain("if (claimed.length === 0)");
    expect(close).toContain("closed before this could be applied");
  });

  it("closes the offer the same way a full target would have", () => {
    // Status FUNDED and every waiting share released through the SAME
    // util the payment webhook uses, so a buyer's preparation deadline
    // does not depend on which door the offer left by.
    const close = service.slice(
      service.indexOf("async closeAtReached("),
      service.indexOf("async extend("),
    );
    expect(close).toContain("SET status = 'FUNDED'");
    expect(close).toContain("decision_window_closes_at = NULL");
    expect(close).toContain("releaseFundedAllocationsTx(tx, id, closedAt)");
  });

  it("touches no commission, because it was charged per order already", () => {
    // «تحسب العمولة على ما بيع فقط» — commission is computed per ORDER
    // at capture on that order's own paid quantity, so an offer closing
    // at sixty per cent has already charged sixty per cent of it.
    const close = service.slice(
      service.indexOf("async closeAtReached("),
      service.indexOf("async extend("),
    );
    expect(close).not.toContain("commission");
    expect(close).not.toContain("Commission");
  });
});
