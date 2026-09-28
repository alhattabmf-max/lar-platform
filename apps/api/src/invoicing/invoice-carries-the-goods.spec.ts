import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

/**
 * AN INVOICE MUST SAY WHAT IT INVOICED, FROM ITSELF.
 *
 * «منتج نشرت له عرضًا وانتهى وتم تسليم المشترين بضاعتهم — خلاص، يتم
 *  التحكم فيه مثل التعديل يكون فيه حذف.»
 *
 * WHAT WAS WRONG, measured on the running database rather than
 * suspected: `master_orders` carried seven snapshots of the PARTIES —
 * the supplier's legal name, CR number, tax and invoicing profiles, the
 * buyer's tax profile and billing name — and `checkout_location_
 * allocations` five of the BRANCH. Every one of them exists so the
 * record outlives the row it was copied from.
 *
 * NOTHING CARRIED THE GOODS. `invoice_documents.snapshot_data` held
 * buyer, seller, currency, shipping, taxAmount, totalInclTax,
 * documentPurpose and subtotalExclTax — no product, no unit, no
 * quantity. The only path to what was sold ran invoice -> order ->
 * opportunity -> approval snapshot -> product, five hops through rows an
 * administrator can delete.
 *
 * SO THE PLATFORM PROTECTED THE PATH INSTEAD OF THE RECORD, and refused
 * to let a sold product go. That is the wrong end: once the invoice is
 * self-contained, deleting the product costs nothing and the owner has
 * the control he asked for.
 *
 * These cases are what stop the pointer from coming back.
 */
describe("the invoice carries the goods, not a pointer to them", () => {
  const webhook = read("src/payments/payment-webhook.service.ts");
  const invoices = read("src/invoicing/invoice.service.ts");
  const schema = read("prisma/schema.prisma");

  it("freezes what was sold on the order, beside who sold it", () => {
    for (const field of [
      "productNameArSnapshot",
      "productNameEnSnapshot",
      "salesUnitNameArSnapshot",
      "salesUnitNameEnSnapshot",
      "unitPriceInclTaxSnapshot",
      "totalQuantitySnapshot",
    ]) {
      expect([field, schema.includes(field)]).toEqual([field, true]);
      expect([field, webhook.includes(field)]).toEqual([field, true]);
    }
  });

  it("reads the name from the APPROVED snapshot, never the live product", () => {
    // The name an order carries must be the one an administrator signed
    // off and the offer was published under — not whatever the supplier
    // renames the product to next week.
    expect(webhook).toContain("tx.productApprovalSnapshot.findUniqueOrThrow");
    expect(webhook).toContain("approvedProduct.nameAr");
    expect(webhook).toContain("approvedProduct.nameEn");
    // AND NEVER FROM `products`. A read of the live row here would
    // reintroduce exactly the coupling this removes.
    expect(webhook).not.toContain("tx.product.findUnique");
  });

  it("refuses to write an order without the snapshot it was published from", () => {
    // The column is nullable on the row; this code path is not. Reaching
    // a capture without one is a data-integrity violation, stated the
    // same way the frozen commission rate is one screen above.
    expect(webhook).toContain("productApprovalSnapshotId === null");
    expect(webhook).toContain("data integrity violation");
  });

  it("puts the line in every invoice document it writes", () => {
    // Three builders: the internal product draft, the commission
    // document, and the adjustment. A line missing from one of them is
    // a document that cannot say what it is about.
    const builders = invoices.match(/const snapshotData = \{/g) ?? [];
    expect(builders).toHaveLength(3);
    expect((invoices.match(/^\s+line:/gm) ?? []).length).toBe(3);
  });

  it("has a credit note carry the line it is correcting", () => {
    // An adjustment exists to correct ONE document, and what that
    // document said was sold is what this one adjusts. Reading the order
    // again could pick up a different answer if anything upstream ever
    // changed; reading the original cannot.
    expect(invoices).toContain("original.snapshotData as { line?: unknown }");
  });

  it("keeps the unit price a SUM of the two halves it is stored as", () => {
    // The opportunity holds `unit_price_excl_tax_amount` and
    // `unit_tax_amount` rather than a third column that could disagree
    // with them. Verified against the one order on this database:
    // 250 + 37.5 = 287.5, ten of them is 2,875, and `total_amount` is
    // 2,925 because it also carries 50 of shipping — so the line and the
    // total do not have to match, and neither is derived from the other.
    expect(webhook).toContain("unitPriceExclTaxAmount");
    expect(webhook).toContain("unitTaxAmount");
  });
});
