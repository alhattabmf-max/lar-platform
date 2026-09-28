import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * WHAT AN UNAPPROVED SUPPLIER MAY AND MAY NOT DO.
 *
 * THE LINE MOVED FOR EXACTLY ONE THING. A supplier assembles its record
 * before asking to be approved — its details, its main branch, its bank
 * account — and the approval reviews the lot. The BANK ACCOUNT crossed
 * to the "before" side for that reason, and nothing else did.
 *
 * WHAT STAYS BEHIND APPROVAL is the commercial work: submitting a
 * product, publishing an opportunity, and the invoicing and tax data
 * that only matter once money moves. None of that is new — this pins it
 * so a future change to the shared guard cannot open all of it at once
 * without somebody deciding to.
 *
 * READ FROM THE SOURCE, because each of these lives in a different
 * service with a different shape of dependency, and a test that mocked
 * four services would be pinning the mocks.
 */

const SRC = join(__dirname, "..");
const read = (path: string) => readFileSync(join(SRC, path), "utf8");

/** Every TypeScript file under src, so a new one cannot slip past. */
function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith(".ts") ? [full] : [];
  });
}

const relativeToSrc = (full: string) => relative(SRC, full).split("\\").join("/");

/**
 * CODE, NOT PROSE. Every comment explaining that a route was removed
 * quotes the route it removed, and a search that reads comments finds
 * the explanation and calls it the offence.
 */
function codeOnly(source: string): string {
  const BLOCK = new RegExp("/\\*[\\s\\S]*?\\*/", "g");
  const LINE = new RegExp("(^|[^:])//.*$", "gm");
  return source.replace(BLOCK, "").replace(LINE, "$1");
}

describe("the approval gate, service by service", () => {
  it("keeps SUBMITTING A PRODUCT behind approval", () => {
    const source = read("products/products.service.ts");

    expect(source).toContain("CompanyVerificationStatus.VERIFIED");
    expect(source).toContain("SUPPLIER_NOT_VERIFIED");
  });

  it("keeps PUBLISHING AN OPPORTUNITY behind approval", () => {
    const source = read("opportunities/opportunities.service.ts");

    expect(source).toContain("SUPPLIER_NOT_VERIFIED");
  });

  /**
   * THREE THINGS ARE ENTERED BEFORE APPROVAL, not after: the bank
   * account, the billing name and the VAT answer.
   *
   * IT USED TO BE ONE. Invoicing and tax sat behind approval, which
   * made the review incomplete in both directions — the administrator
   * was asked to approve a company whose billing identity it could not
   * see, and the supplier was told to wait for an approval that was
   * waiting for them. That is the same circle the bank account was
   * moved out of first, and this moves the other two out of it.
   *
   * WHAT APPROVAL GATES IS UNCHANGED, and the cases above this one are
   * what prove it: a product, a listing, an order, a payout. Only WHEN
   * the data may be typed moved.
   */
  it("lets the BANK ACCOUNT, the BILLING NAME and the VAT answer be entered before it", () => {
    for (const file of [
      "financial/bank-accounts.service.ts",
      "financial/invoicing-profile.service.ts",
      "financial/tax-profile.service.ts",
    ]) {
      const source = read(file);
      expect([file, source.includes("requireSupplierCompany(this.prisma, ctx.companyId)")]).toEqual([
        file,
        true,
      ]);
      expect([file, source.includes("requireVerifiedSupplierCompany(")]).toEqual([
        file,
        false,
      ]);
    }
  });

  it("still refuses a BUYER those three, because only a supplier is paid", () => {
    // The guard that remains checks the account type, and that half was
    // never relaxed.
    for (const file of [
      "financial/bank-accounts.service.ts",
      "financial/invoicing-profile.service.ts",
      "financial/tax-profile.service.ts",
    ]) {
      expect([file, read(file).includes("requireSupplierCompany")]).toEqual([
        file,
        true,
      ]);
    }
    expect(read("financial/require-verified-supplier.ts")).toContain(
      "Only supplier accounts have financial readiness data",
    );
  });

  it("still refuses a buyer everywhere money leaves the platform", () => {
    // Both guards check the account type first; only the second adds
    // the approval on top.
    const guard = read("financial/require-verified-supplier.ts");

    expect(guard).toContain("company.accountType !== AccountType.SUPPLIER");
    expect(guard).toContain("requireVerifiedSupplierCompany");
    expect(guard).toContain("requireSupplierCompany");
  });

  it("names one refusal code, so a screen can explain it", () => {
    // A generic 403 tells a supplier nothing it can act on. Every gate
    // above answers with the same code, which is what lets the portal
    // say "your account needs approval" and link to the record.
    for (const file of [
      "products/products.service.ts",
      "opportunities/opportunities.service.ts",
      "financial/require-verified-supplier.ts",
    ]) {
      expect([file, read(file).includes("SUPPLIER_NOT_VERIFIED")]).toEqual([
        file,
        true,
      ]);
    }
  });
});

describe("approving the request is the only way a supplier is verified", () => {
  it("leaves no other file able to write VERIFIED", () => {
    // SEARCHED, NOT LISTED. Naming three files to check would pass
    // the day somebody adds a fourth. Every source file under src is
    // read, and the only ones allowed to put a company into VERIFIED
    // are named here with the reason.
    const ALLOWED = new Map([
      [
        "verification/supplier-verification-request.service.ts",
        "the decision on a submitted request — the approved path",
      ],
      [
        "auth/auth.service.ts",
        "a BUYER at registration: buyers are not verified suppliers and have nothing to submit",
      ],
      [
        "verification/verification.service.ts",
        "the automatic-mode check, dormant unless COMPANY_VERIFICATION_MODE is AUTOMATIC",
      ],
    ]);

    const offenders = [];
    for (const file of walk(SRC)) {
      if (file.endsWith(".spec.ts")) continue;
      const relative = relativeToSrc(file);
      if (ALLOWED.has(relative)) continue;

      const source = codeOnly(readFileSync(file, "utf8"));
      if (
        /verificationStatus:\s*CompanyVerificationStatus\.VERIFIED/.test(source) ||
        source.includes("verification.approve(")
      ) {
        offenders.push(relative);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("has no self-service route back out of a refusal", () => {
    // `reapply` moved a REJECTED company to PENDING with nobody
    // deciding. A supplier could refuse its own refusal.
    for (const file of walk(SRC)) {
      // The tests themselves quote the route they are forbidding.
      if (file.endsWith(".spec.ts")) continue;
      const source = codeOnly(readFileSync(file, "utf8"));
      expect([
        relativeToSrc(file),
        /async\s+reapply\s*\(/.test(source) || source.includes("verification/reapply"),
      ]).toEqual([relativeToSrc(file), false]);
    }
  });

  it("has no admin bank-account surface at all any more", () => {
    // Two decisions over one supplier produced two queues and a
    // state nobody could explain, so the account stopped being
    // approved on its own and the admin service became a read.
    //
    // THEN THE SCREEN WENT — «أبغى ألغي صفحة الحسابات البنكية، ما
    //  أحتاجها، لأن كل حساب يخصّ مورّدًا فبالضرورة أدخل للمورّد
    //  وتفاصيله» — and a read nothing can reach is a capability the
    //  platform does not have. The holder, the bank and the last
    //  four digits are on the supplier's own record now, beside
    //  the button that decides the request they belong to.
    expect(
      existsSync(join(SRC, "admin/financial/admin-bank-accounts.service.ts")),
    ).toBe(false);
    expect(
      existsSync(
        join(SRC, "admin/financial/admin-bank-accounts.controller.ts"),
      ),
    ).toBe(false);
  });
});
