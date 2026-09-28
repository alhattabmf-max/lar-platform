import {
  BankAccountVerificationStatus,
  CompanyVerificationStatus,
  SupplierVerificationRequestStatus,
} from "@prisma/client";
import { supplierVerificationView } from "@platform/types";
import { SupplierVerificationRequestService } from "./supplier-verification-request.service";

/**
 * ONE REQUEST, ONE DECISION.
 *
 * These cases cover the whole path: what a supplier may send, what an
 * administrator may do with it, and — the part that is easy to lose —
 * what approving is NOT allowed to happen without.
 */

// ---------------------------------------------------------------------
// A company as `viewFor` reads it.
// ---------------------------------------------------------------------
function companyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "company-a",
    accountType: "SUPPLIER",
    legalName: "شركة الاختبار",
    crNumber: "1010101010",
    verificationStatus: CompanyVerificationStatus.PENDING_VERIFICATION,
    _count: { locations: 1, bankAccounts: 1 },
    // THE BILLING IDENTITY, which a supplier now supplies before asking
    // to be approved rather than after. A complete company has both
    // rows, and a VAT answer that is finished.
    invoicingProfile: { invoicingLegalName: "شركة الاختبار" },
    taxProfile: { isVatRegistered: true, vatNumber: "310123456700003" },
    users: [{ primaryMobile1: "+966500000000" }],
    ...overrides,
  };
}

function requestRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "request-1",
    status: SupplierVerificationRequestStatus.UNDER_REVIEW,
    submittedAt: new Date("2026-08-01T00:00:00.000Z"),
    decidedAt: null,
    decisionReason: null,
    ...overrides,
  };
}

interface Harness {
  service: SupplierVerificationRequestService;
  create: jest.Mock;
  tx: {
    supplierVerificationRequest: { update: jest.Mock };
    supplierBankAccount: { findFirst: jest.Mock; update: jest.Mock };
    company: { findUniqueOrThrow: jest.Mock; update: jest.Mock };
    $queryRaw: jest.Mock;
  };
  audit: jest.Mock;
}

function harness(options: {
  company?: Record<string, unknown>;
  latest?: Record<string, unknown> | null;
  openRequest?: boolean;
  pendingBank?: { id: string } | null;
  activeBankAccountId?: string | null;
  payoutHoldDays?: number;
}): Harness {
  const {
    company = companyRow(),
    latest = null,
    openRequest = true,
    pendingBank = { id: "bank-new" },
    activeBankAccountId = null,
    payoutHoldDays = 3,
  } = options;

  const tx = {
    supplierVerificationRequest: {
      update: jest
        .fn()
        .mockImplementation(async ({ data }) => ({ id: "request-1", ...data })),
    },
    supplierBankAccount: {
      findFirst: jest.fn().mockResolvedValue(pendingBank),
      update: jest.fn().mockResolvedValue(undefined),
    },
    company: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        verificationStatus: CompanyVerificationStatus.PENDING_VERIFICATION,
        activeBankAccountId,
      }),
      update: jest.fn().mockResolvedValue(undefined),
    },
    $queryRaw: jest
      .fn()
      .mockResolvedValue(openRequest ? [{ id: "request-1" }] : []),
  };

  const create = jest.fn().mockResolvedValue({
    id: "request-new",
    status: SupplierVerificationRequestStatus.UNDER_REVIEW,
  });

  const prisma = {
    company: { findUniqueOrThrow: jest.fn().mockResolvedValue(company) },
    supplierVerificationRequest: {
      findFirst: jest.fn().mockResolvedValue(latest),
      create,
    },
    $transaction: jest.fn(
      async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    ),
  };

  const audit = jest.fn().mockResolvedValue(undefined);

  const service = new SupplierVerificationRequestService(
    prisma as never,
    { log: audit } as never,
    { getPayoutHoldDays: jest.fn().mockResolvedValue(payoutHoldDays) } as never,
  );

  return { service, create, tx, audit };
}

const CTX = { requestId: "request" };

// =====================================================================
// The six states
// =====================================================================
describe("the six states a supplier can be in", () => {
  const complete = { profileComplete: true };
  const incomplete = { profileComplete: false };
  const pending = CompanyVerificationStatus.PENDING_VERIFICATION;

  it("INCOMPLETE while anything required is missing", () => {
    const view = supplierVerificationView({
      companyStatus: pending,
      latestRequest: null,
      ...incomplete,
    });
    expect(view.state).toBe("INCOMPLETE");
    expect(view.canSubmit).toBe(false);
    expect(view.dataLocked).toBe(false);
  });

  it("READY_TO_SUBMIT once everything is there and nothing has been sent", () => {
    const view = supplierVerificationView({
      companyStatus: pending,
      latestRequest: null,
      ...complete,
    });
    expect(view.state).toBe("READY_TO_SUBMIT");
    expect(view.canSubmit).toBe(true);
  });

  it("UNDER_REVIEW locks the data and offers no action", () => {
    const view = supplierVerificationView({
      companyStatus: pending,
      latestRequest: {
        id: "r",
        status: "UNDER_REVIEW",
        submittedAt: "2026-08-01T00:00:00.000Z",
        decidedAt: null,
        decisionReason: null,
      },
      ...complete,
    });
    expect(view.state).toBe("UNDER_REVIEW");
    expect(view.dataLocked).toBe(true);
    expect(view.canSubmit).toBe(false);
  });

  it("NEEDS_COMPLETION shows the reason, unlocks, and allows sending again", () => {
    const view = supplierVerificationView({
      companyStatus: pending,
      latestRequest: {
        id: "r",
        status: "RETURNED_FOR_COMPLETION",
        submittedAt: "2026-08-01T00:00:00.000Z",
        decidedAt: "2026-08-02T00:00:00.000Z",
        decisionReason: "رقم السجل التجاري غير مطابق",
      },
      ...complete,
    });
    expect(view.state).toBe("NEEDS_COMPLETION");
    expect(view.reason).toBe("رقم السجل التجاري غير مطابق");
    expect(view.dataLocked).toBe(false);
    expect(view.canSubmit).toBe(true);
  });

  it("NEEDS_COMPLETION still refuses to send while something is missing", () => {
    const view = supplierVerificationView({
      companyStatus: pending,
      latestRequest: {
        id: "r",
        status: "RETURNED_FOR_COMPLETION",
        submittedAt: "2026-08-01T00:00:00.000Z",
        decidedAt: "2026-08-02T00:00:00.000Z",
        decisionReason: "أضف الحساب البنكي",
      },
      ...incomplete,
    });
    expect(view.state).toBe("NEEDS_COMPLETION");
    expect(view.canSubmit).toBe(false);
  });

  it("VERIFIED after approval, with nothing left to send", () => {
    const view = supplierVerificationView({
      companyStatus: CompanyVerificationStatus.VERIFIED,
      latestRequest: null,
      ...complete,
    });
    expect(view.state).toBe("VERIFIED");
    expect(view.canSubmit).toBe(false);
  });

  it("REJECTED is terminal — the reason shows and no button does", () => {
    const view = supplierVerificationView({
      companyStatus: CompanyVerificationStatus.REJECTED,
      latestRequest: {
        id: "r",
        status: "REJECTED",
        submittedAt: "2026-08-01T00:00:00.000Z",
        decidedAt: "2026-08-02T00:00:00.000Z",
        decisionReason: "السجل التجاري منتهٍ",
      },
      ...complete,
    });
    expect(view.state).toBe("REJECTED");
    expect(view.reason).toBe("السجل التجاري منتهٍ");
    // Even with a complete record. Re-opening a refusal is an
    // administrator's decision, never a button the supplier can press.
    expect(view.canSubmit).toBe(false);
  });
});

// =====================================================================
// What a supplier may send
// =====================================================================
describe("submitting a verification request", () => {
  it("refuses while the company details are missing", async () => {
    const { service, create } = harness({
      company: companyRow({ crNumber: "   " }),
    });

    await expect(service.submit("company-a", "user-a", CTX)).rejects.toThrow(
      /cannot be sent from state INCOMPLETE/,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("refuses while there is no main branch", async () => {
    const { service, create } = harness({
      company: companyRow({ _count: { locations: 0, bankAccounts: 1 } }),
    });

    await expect(service.submit("company-a", "user-a", CTX)).rejects.toThrow(
      /cannot be sent from state INCOMPLETE/,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("refuses while there is no bank account", async () => {
    const { service, create } = harness({
      company: companyRow({ _count: { locations: 1, bankAccounts: 0 } }),
    });

    await expect(service.submit("company-a", "user-a", CTX)).rejects.toThrow(
      /cannot be sent from state INCOMPLETE/,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("refuses while a mobile number is missing", async () => {
    const { service, create } = harness({
      company: companyRow({ users: [{ primaryMobile1: "" }] }),
    });

    await expect(service.submit("company-a", "user-a", CTX)).rejects.toThrow(
      /cannot be sent from state INCOMPLETE/,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("sends once everything is there", async () => {
    const { service, create, audit } = harness({});

    await service.submit("company-a", "user-a", CTX);

    expect(create).toHaveBeenCalledWith({
      data: { companyId: "company-a", submittedByUserId: "user-a" },
    });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "SUPPLIER_VERIFICATION_REQUESTED" }),
    );
  });

  it("refuses a second send while one is already under review", async () => {
    const { service, create } = harness({ latest: requestRow() });

    await expect(service.submit("company-a", "user-a", CTX)).rejects.toThrow(
      /cannot be sent from state UNDER_REVIEW/,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("refuses after a rejection — that decision is not the supplier's to undo", async () => {
    const { service, create } = harness({
      company: companyRow({
        verificationStatus: CompanyVerificationStatus.REJECTED,
      }),
      latest: requestRow({
        status: SupplierVerificationRequestStatus.REJECTED,
        decisionReason: "السجل التجاري منتهٍ",
      }),
    });

    await expect(service.submit("company-a", "user-a", CTX)).rejects.toThrow(
      /cannot be sent from state REJECTED/,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("allows sending again after a return", async () => {
    const { service, create } = harness({
      latest: requestRow({
        status: SupplierVerificationRequestStatus.RETURNED_FOR_COMPLETION,
        decisionReason: "أضف رقم جوال ثانٍ",
      }),
    });

    await service.submit("company-a", "user-a", CTX);
    expect(create).toHaveBeenCalled();
  });

  it("refuses a buyer outright", async () => {
    const { service } = harness({
      company: companyRow({ accountType: "TRADER" }),
    });

    await expect(service.submit("company-a", "user-a", CTX)).rejects.toThrow(
      /Only supplier accounts/,
    );
  });
});

// =====================================================================
// The lock
// =====================================================================
describe("the data under review", () => {
  it("is closed to edits while a request is open", async () => {
    const service = new SupplierVerificationRequestService(
      {
        supplierVerificationRequest: {
          findFirst: jest.fn().mockResolvedValue({ id: "request-1" }),
        },
      } as never,
      {} as never,
      {} as never,
    );

    await expect(service.assertNotUnderReview("company-a")).rejects.toThrow(
      /being reviewed/,
    );
  });

  it("is open again once there is no request under review", async () => {
    const service = new SupplierVerificationRequestService(
      {
        supplierVerificationRequest: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
      } as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.assertNotUnderReview("company-a"),
    ).resolves.toBeUndefined();
  });
});

// =====================================================================
// Adding a bank account is not a back door
// =====================================================================
describe("adding a bank account", () => {
  it("neither verifies the company nor activates the account", async () => {
    // A complete record with no request sent is READY_TO_SUBMIT — not
    // verified, not under review, and pointing at no active account.
    const { service, tx } = harness({});

    const view = await service.viewFor("company-a");

    expect(view.state).toBe("READY_TO_SUBMIT");
    expect(view.state).not.toBe("VERIFIED");
    expect(tx.company.update).not.toHaveBeenCalled();
    expect(tx.supplierBankAccount.update).not.toHaveBeenCalled();
  });
});

// =====================================================================
// The administrator's decision
// =====================================================================
describe("deciding a request", () => {
  it("approves the open request and verifies the company in one transaction", async () => {
    const { service, tx } = harness({});

    await service.approve("company-a", "admin-a", CTX);

    // The row was locked before it was read.
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.supplierVerificationRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "request-1" },
        data: expect.objectContaining({
          status: SupplierVerificationRequestStatus.APPROVED,
          decidedByAdminId: "admin-a",
        }),
      }),
    );
    expect(tx.company.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          verificationStatus: CompanyVerificationStatus.VERIFIED,
        }),
      }),
    );
  });

  it("carries the bank account through: VERIFIED, pointed at, and held", async () => {
    const { service, tx } = harness({
      activeBankAccountId: null,
      payoutHoldDays: 3,
    });

    await service.approve("company-a", "admin-a", CTX);

    expect(tx.supplierBankAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "bank-new" },
        data: expect.objectContaining({
          verificationStatus: BankAccountVerificationStatus.VERIFIED,
        }),
      }),
    );

    const pointer = tx.company.update.mock.calls.find(
      ([arg]) => arg.data.activeBankAccountId !== undefined,
    );
    expect(pointer).toBeDefined();
    expect(pointer[0].data.activeBankAccountId).toBe("bank-new");
    // Without a payout hold the settlement rules would have no window
    // to work from — the same three days the removed standalone
    // approval applied.
    expect(pointer[0].data.payoutHoldUntil).toBeInstanceOf(Date);
  });

  it("supersedes the account it replaces", async () => {
    const { service, tx } = harness({ activeBankAccountId: "bank-old" });

    await service.approve("company-a", "admin-a", CTX);

    expect(tx.supplierBankAccount.update).toHaveBeenCalledWith({
      where: { id: "bank-old" },
      data: { verificationStatus: BankAccountVerificationStatus.SUPERSEDED },
    });
  });

  it("refuses to approve a supplier with no account to pay into", async () => {
    const { service } = harness({
      pendingBank: null,
      activeBankAccountId: null,
    });

    await expect(service.approve("company-a", "admin-a", CTX)).rejects.toThrow(
      /no bank account to approve/,
    );
  });

  it("returns the request without moving the company", async () => {
    const { service, tx } = harness({});

    await service.returnForCompletion(
      "company-a",
      "admin-a",
      "أضف الحساب البنكي",
      CTX,
    );

    expect(tx.supplierVerificationRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: SupplierVerificationRequestStatus.RETURNED_FOR_COMPLETION,
          decisionReason: "أضف الحساب البنكي",
        }),
      }),
    );
    // A return is not a refusal: the company stays exactly where it was.
    expect(tx.company.update).not.toHaveBeenCalled();
    expect(tx.supplierBankAccount.update).not.toHaveBeenCalled();
  });

  it("rejects the request and the company together", async () => {
    const { service, tx } = harness({});

    await service.reject("company-a", "admin-a", "السجل التجاري منتهٍ", CTX);

    expect(tx.supplierVerificationRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: SupplierVerificationRequestStatus.REJECTED,
          decisionReason: "السجل التجاري منتهٍ",
        }),
      }),
    );
    expect(tx.company.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          verificationStatus: CompanyVerificationStatus.REJECTED,
        }),
      }),
    );
    // A refused supplier is not one we pay.
    expect(tx.supplierBankAccount.update).not.toHaveBeenCalled();
  });

  it("demands a reason before returning", async () => {
    const { service, tx } = harness({});

    await expect(
      service.returnForCompletion("company-a", "admin-a", "   ", CTX),
    ).rejects.toThrow(/reason is required/);
    expect(tx.supplierVerificationRequest.update).not.toHaveBeenCalled();
  });

  it("demands a reason before rejecting", async () => {
    const { service, tx } = harness({});

    await expect(
      service.reject("company-a", "admin-a", "", CTX),
    ).rejects.toThrow(/reason is required/);
    expect(tx.supplierVerificationRequest.update).not.toHaveBeenCalled();
  });

  it("refuses a second decision once the request is no longer under review", async () => {
    const { service, tx } = harness({ openRequest: false });

    await expect(service.approve("company-a", "admin-a", CTX)).rejects.toThrow(
      /no verification request under review/,
    );
    expect(tx.company.update).not.toHaveBeenCalled();
    expect(tx.supplierBankAccount.update).not.toHaveBeenCalled();
  });

  it("records every decision with its reason", async () => {
    const { service, audit } = harness({});

    await service.reject("company-a", "admin-a", "السجل التجاري منتهٍ", CTX);

    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "SUPPLIER_VERIFICATION_REJECTED",
        reason: "السجل التجاري منتهٍ",
      }),
      expect.anything(),
    );
  });
});
