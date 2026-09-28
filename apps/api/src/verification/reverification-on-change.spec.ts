import { SupplierVerificationRequestService } from "./supplier-verification-request.service";

/**
 * A VERIFIED SUPPLIER CHANGED SOMETHING THE APPROVAL RESTED ON.
 *
 * «في كل الحالات، أي تعديل لازم يكون فيه إعادة إرسال توثيق» — and the
 * line between "any" and "the ones that matter" is the whole design:
 * a wrong telephone costs a missed call, a wrong IBAN costs the money.
 * The list lives in `@platform/types` and the rule is applied HERE, on
 * the write path, so a client posting straight at an endpoint meets it
 * too.
 *
 * WHAT THESE TESTS GUARD is the three ways it could be got wrong:
 * dragging a BUYER into a review it never has, punishing a company
 * that had nothing to lose, and — the one that would be silent —
 * LOCKING the record instead of marking it, which would shut a
 * supplier out after their first correction.
 */

const ctx = { requestId: "req-1", ipAddress: "10.0.0.1", userAgent: "jest" };

function build(company: Record<string, unknown> | null) {
  const update = jest.fn();
  const log = jest.fn();
  const prisma = {
    company: {
      findUnique: jest.fn().mockResolvedValue(company),
      update,
    },
  } as never;

  return {
    service: new SupplierVerificationRequestService(
      prisma,
      { log } as never,
      {} as never,
    ),
    update,
    log,
  };
}

describe("markChangedSinceApproval", () => {
  it("takes a VERIFIED supplier back to pending, and records why", async () => {
    const { service, update, log } = build({
      accountType: "SUPPLIER",
      verificationStatus: "VERIFIED",
    });

    await service.markChangedSinceApproval("c1", "BANK_ACCOUNT", ctx);

    expect(update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { verificationStatus: "PENDING_VERIFICATION" },
    });
    expect(log.mock.calls[0][0]).toMatchObject({
      actorType: "SYSTEM",
      companyId: "c1",
      action: "COMPANY_REVERIFICATION_REQUIRED",
      entityType: "company",
      entityId: "c1",
      before: { verificationStatus: "VERIFIED" },
      after: {
        verificationStatus: "PENDING_VERIFICATION",
        trigger: "BANK_ACCOUNT",
      },
    });
  });

  it("MARKS rather than locks — the record stays open to the next edit", async () => {
    // «لو بغى يعدّل شغلتين» — the state it lands in is the one a
    // supplier is in before its first approval, where `dataLocked` is
    // false. What closes the record is SUBMITTING the request, and
    // nothing here submits one.
    const { service, update } = build({
      accountType: "SUPPLIER",
      verificationStatus: "VERIFIED",
    });

    await service.markChangedSinceApproval("c1", "TAX_PROFILE", ctx);

    expect(update.mock.calls[0][0].data).toEqual({
      verificationStatus: "PENDING_VERIFICATION",
    });
    // No request is opened, and nothing is suspended.
    expect(update.mock.calls[0][0].data).not.toHaveProperty("status");
  });

  it("never touches a BUYER, which is registered verified and never reviewed", async () => {
    const { service, update, log } = build({
      accountType: "TRADER",
      verificationStatus: "VERIFIED",
    });

    await service.markChangedSinceApproval("c1", "INVOICING_NAME", ctx);

    expect(update).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it("leaves a supplier that is not verified exactly where it is", async () => {
    // Pending, returned, rejected and suspended each mean something
    // an edit must not overwrite — and a company with no approval has
    // none to lose.
    for (const status of [
      "PENDING_VERIFICATION",
      "REJECTED",
      "SUSPENDED",
    ]) {
      const { service, update, log } = build({
        accountType: "SUPPLIER",
        verificationStatus: status,
      });

      await service.markChangedSinceApproval("c1", "BRANCH_ADDED", ctx);

      expect(update).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
    }
  });

  it("says nothing about a company that is not there", async () => {
    const { service, update } = build(null);

    await service.markChangedSinceApproval("gone", "BRANCH_MOVED", ctx);

    expect(update).not.toHaveBeenCalled();
  });
});
