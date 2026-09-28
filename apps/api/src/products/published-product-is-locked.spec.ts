import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ProductsService } from "./products.service";

const ROOT = join(__dirname, "..", "..");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

/**
 * A PUBLISHED PRODUCT IS NOT THE SUPPLIER'S TO EDIT.
 *
 * «بعدها يقدر يعدل عليه أو يسوي له نشر؛ إذا نشره خلاص ما يقدر يعدل عليه.
 *  لكن لو كان فيه خطأ في البيانات بعد النشر لازم الإدارة تتدخل.»
 *
 * WHAT IT USED TO DO, and it was the wrong way round: an APPROVED
 * product returned `requiresReapproval: true` — edit freely, and a fresh
 * approval snapshot afterwards. So a supplier could change the name, the
 * weight and the dimensions of a product WITH A LIVE OFFER AND BUYERS ON
 * IT, while the running offer still pointed at the OLD snapshot and went
 * on selling specifications the row no longer held.
 *
 * MEANWHILE THE ADMIN, WHO SHOULD BE ABLE TO INTERVENE, HAD NO EDIT AT
 * ALL — approve, reject, suspend, close, reactivate, and nothing else.
 * The one who should have been stopped could act, and the one who should
 * have acted could not.
 */
describe("a published product is locked", () => {
  const service = read("src/products/products.service.ts");

  function tx(liveOffers: number) {
    return { opportunity: { count: jest.fn(async () => liveOffers) } } as never;
  }
  const product = { id: "p1", archivedAt: null, approvalStatus: "APPROVED" } as never;
  const build = () => new ProductsService({} as never, { log: jest.fn() } as never);

  it("refuses an edit while a buyer can reach it", async () => {
    await expect(build().assertEditableTx(tx(1), product)).rejects.toMatchObject({
      status: 409,
    });
    await expect(
      build()
        .assertEditableTx(tx(1), product)
        .catch((e) => {
          throw e.getResponse();
        })
    ).rejects.toMatchObject({ code: "PRODUCT_HAS_LIVE_OFFER" });
  });

  it("allows it again once nothing is published", async () => {
    // «الإدارة توقف العرض… ويرجع المورد ينشر عرض ثاني بعد ما يصحح
    //  المشكلة» — a permanent lock would make one mistake permanent too.
    await expect(build().assertEditableTx(tx(0), product)).resolves.toEqual({
      requiresReapproval: true,
    });
  });

  it("locks on the OFFER, never on the approval", () => {
    // A product approved and never published is a draft in every sense
    // that matters. What closes it is a buyer being able to see it.
    expect(service).toContain("OFFER_LOCKS_THE_PRODUCT");
    for (const status of ["SCHEDULED", "ACTIVE", "PAUSED", "FUNDED"]) {
      expect([status, (ProductsService.OFFER_LOCKS_THE_PRODUCT as readonly string[]).includes(status)]).toEqual([
        status,
        true,
      ]);
    }
    // AND NOT ON A FINISHED ONE: an offer that expired or was cancelled
    // is read by nobody, so the product it names is free again.
    for (const status of ["EXPIRED", "CANCELLED", "DRAFT"]) {
      expect([status, (ProductsService.OFFER_LOCKS_THE_PRODUCT as readonly string[]).includes(status)]).toEqual([
        status,
        false,
      ]);
    }
  });

  it("counts inside the caller's transaction, not beside it", () => {
    // The check and the write must see one state. Reading through
    // `this.prisma` would let an offer be published between the two.
    expect(service).toContain("await tx.opportunity.count(");
    expect(service).not.toContain("this.prisma.opportunity.count(");
  });

  it("says what to do, not just that it refused", () => {
    // The console translates by CODE and never shows the server's own
    // sentence, so a shared CONFLICT reaches a supplier as a line naming
    // neither the cause nor the next step.
    expect(service).toContain("ERROR_CODES.PRODUCT_HAS_LIVE_OFFER");
  });
});
