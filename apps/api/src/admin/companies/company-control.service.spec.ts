import { NotFoundException } from "@nestjs/common";
import { CompanyVerificationStatus, UserStatus } from "@prisma/client";
import { CompanyControlService } from "./company-control.service";
import { BusinessException } from "../../common/errors/business-exception";
import type { PrismaService } from "../../database/prisma.service";
import type { AuditService } from "../../audit/audit.service";
import type { SessionService } from "../../common/security/session.service";
import type { CompanyDeletionEligibilityService } from "./company-deletion-eligibility.service";

/**
 * Suspending, reactivating and removing a company.
 *
 * The property under test throughout is WHO ELSE IS AFFECTED. Every one
 * of these acts on a company but moves its people, and the mistakes
 * worth guarding are all of the same shape: reinstating somebody who
 * was suspended for their own reason, signing people out of an action
 * that then failed to save, or removing a company whose orders nothing
 * in the database would have stopped.
 */

const COMPANY = "11111111-1111-4111-8111-111111111111";
const CTX = { actorId: "admin-1", requestId: "req-1" };

interface UserRow {
  id: string;
  status: UserStatus;
  statusBeforeCompanySuspension: UserStatus | null;
}

function makeService(
  options: {
    company?: { verificationStatus: CompanyVerificationStatus } | null;
    users?: UserRow[];
    eligible?: boolean;
    blockers?: { kind: string; count: number }[];
    suspendedFrom?: CompanyVerificationStatus;
    revokeThrows?: boolean;
  } = {},
) {
  const trace: string[] = [];
  const users = new Map(
    (options.users ?? []).map((user) => [user.id, { ...user }]),
  );
  const company =
    options.company === null
      ? null
      : {
          verificationStatus: CompanyVerificationStatus.VERIFIED,
          ...options.company,
        };

  let companyDeleted = false;

  const audited: { action: string; payload: Record<string, unknown> }[] = [];
  const auditLog = jest.fn(async (input: Record<string, unknown>) => {
    trace.push("AUDIT");
    audited.push({ action: String(input.action), payload: input });
  });

  const model = {
    company: {
      findUnique: jest.fn(async () => (companyDeleted ? null : company)),
      update: jest.fn(
        async ({
          data,
        }: {
          data: { verificationStatus: CompanyVerificationStatus };
        }) => {
          trace.push("COMPANY_UPDATE");
          if (company) company.verificationStatus = data.verificationStatus;
          return company;
        },
      ),
      delete: jest.fn(async () => {
        trace.push("COMPANY_DELETE");
        companyDeleted = true;
        return company;
      }),
    },
    user: {
      findMany: jest.fn(async (args: { where: Record<string, unknown> }) => {
        const all = [...users.values()];
        if (args.where.status === UserStatus.ACTIVE) {
          return all.filter((user) => user.status === UserStatus.ACTIVE);
        }
        if (args.where.statusBeforeCompanySuspension) {
          return all.filter(
            (user) => user.statusBeforeCompanySuspension !== null,
          );
        }
        return all;
      }),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<UserRow>;
        }) => {
          trace.push("USER_UPDATE");
          Object.assign(users.get(where.id)!, data);
          return users.get(where.id);
        },
      ),
      deleteMany: jest.fn(async () => {
        trace.push("USER_DELETE");
        const count = users.size;
        users.clear();
        return { count };
      }),
    },
    auditLog: {
      findFirst: jest.fn(async () =>
        options.suspendedFrom
          ? { beforeData: { verificationStatus: options.suspendedFrom } }
          : null,
      ),
    },
  };

  const emptyDelete = jest.fn(async () => ({ count: 0 }));
  const tx = {
    ...model,
    notificationRecipient: { deleteMany: emptyDelete },
    notification: { deleteMany: emptyDelete },
    passwordResetToken: { deleteMany: emptyDelete },
    emailVerificationToken: { deleteMany: emptyDelete },

    // THE SWEEP. A bank account, a branch, a profile, an accepted
    // policy and an abandoned checkout no longer stop a removal, so
    // the removal has to take them: every one carries an ON DELETE
    // RESTRICT key to `companies` and would otherwise fail the
    // transaction with a constraint name.
    quoteSnapshot: { deleteMany: emptyDelete },
    checkoutLocationAllocation: { deleteMany: emptyDelete },
    checkoutSession: { deleteMany: emptyDelete },
    policyAcceptance: { deleteMany: emptyDelete },
    opportunity: { deleteMany: emptyDelete },
    productMedia: { deleteMany: emptyDelete },
    productApprovalSnapshot: { deleteMany: emptyDelete },
    product: { deleteMany: emptyDelete },
    supplierVerificationRequest: { deleteMany: emptyDelete },
    supplierBankAccount: { deleteMany: emptyDelete },
    supplierTaxProfile: { deleteMany: emptyDelete },
    traderTaxProfile: { deleteMany: emptyDelete },
    supplierInvoicingProfile: { deleteMany: emptyDelete },
    companyContact: { deleteMany: emptyDelete },
    companyLocation: { deleteMany: emptyDelete },
  };

  const prisma = {
    $transaction: jest.fn(async (fn: (client: unknown) => Promise<unknown>) => {
      trace.push("TX_BEGIN");
      const result = await fn(tx);
      trace.push("TX_COMMIT");
      return result;
    }),
  } as unknown as PrismaService;

  const revoked: string[] = [];
  const sessions = {
    revokeAllForUser: jest.fn(async (userId: string) => {
      trace.push("REVOKE");
      if (options.revokeThrows) throw new Error("redis unreachable");
      revoked.push(userId);
    }),
  } as unknown as SessionService;

  const eligibility = {
    check: jest.fn(async () => ({
      allowed: options.eligible ?? true,
      blockers: options.blockers ?? [],
    })),
  } as unknown as CompanyDeletionEligibilityService;

  const service = new CompanyControlService(
    prisma,
    { log: auditLog } as unknown as AuditService,
    sessions,
    eligibility,
  );

  return { service, trace, users, audited, revoked, company, eligibility };
}

describe("suspending a company moves its people too", () => {
  it("suspends the company and every ACTIVE user", async () => {
    const { service, users, company } = makeService({
      users: [
        {
          id: "u1",
          status: UserStatus.ACTIVE,
          statusBeforeCompanySuspension: null,
        },
        {
          id: "u2",
          status: UserStatus.ACTIVE,
          statusBeforeCompanySuspension: null,
        },
      ],
    });

    const result = await service.suspend(COMPANY, "fraud investigation", CTX);

    expect(result.usersSuspended).toBe(2);
    expect(company!.verificationStatus).toBe(
      CompanyVerificationStatus.SUSPENDED,
    );
    expect(users.get("u1")!.status).toBe(UserStatus.SUSPENDED);
  });

  it("RECORDS what to put each user back to", async () => {
    // Not inferred later from the audit trail: replaying a log to
    // rebuild current state is a different kind of claim from reading
    // a column.
    const { service, users } = makeService({
      users: [
        {
          id: "u1",
          status: UserStatus.ACTIVE,
          statusBeforeCompanySuspension: null,
        },
      ],
    });

    await service.suspend(COMPANY, "reason enough", CTX);

    expect(users.get("u1")!.statusBeforeCompanySuspension).toBe(
      UserStatus.ACTIVE,
    );
  });

  it("LEAVES ALONE a user who was already suspended for their own reason", async () => {
    const { service, users } = makeService({
      users: [
        {
          id: "u1",
          status: UserStatus.ACTIVE,
          statusBeforeCompanySuspension: null,
        },
        {
          id: "u2",
          status: UserStatus.SUSPENDED,
          statusBeforeCompanySuspension: null,
        },
        {
          id: "u3",
          status: UserStatus.DISABLED,
          statusBeforeCompanySuspension: null,
        },
      ],
    });

    await service.suspend(COMPANY, "reason enough", CTX);

    // Untouched, and — crucially — unmarked, so reactivation cannot
    // sweep them up.
    expect(users.get("u2")!.statusBeforeCompanySuspension).toBeNull();
    expect(users.get("u3")!.status).toBe(UserStatus.DISABLED);
    expect(users.get("u3")!.statusBeforeCompanySuspension).toBeNull();
  });

  it("revokes sessions only AFTER the database commits", async () => {
    const { service, trace } = makeService({
      users: [
        {
          id: "u1",
          status: UserStatus.ACTIVE,
          statusBeforeCompanySuspension: null,
        },
      ],
    });

    await service.suspend(COMPANY, "reason enough", CTX);

    // Redis shares no transaction with the database. Revoking first
    // would sign someone out of a suspension that then failed to save.
    expect(trace.indexOf("TX_COMMIT")).toBeLessThan(trace.indexOf("REVOKE"));
  });

  it("still succeeds when session revocation fails", async () => {
    // The suspension is committed. Reporting a failure for work that
    // succeeded would be a lie.
    const { service, company } = makeService({
      users: [
        {
          id: "u1",
          status: UserStatus.ACTIVE,
          statusBeforeCompanySuspension: null,
        },
      ],
      revokeThrows: true,
    });

    await expect(
      service.suspend(COMPANY, "reason enough", CTX),
    ).resolves.toMatchObject({
      usersSuspended: 1,
    });
    expect(company!.verificationStatus).toBe(
      CompanyVerificationStatus.SUSPENDED,
    );
  });

  it("refuses a company that is already suspended", async () => {
    const { service } = makeService({
      company: { verificationStatus: CompanyVerificationStatus.SUSPENDED },
    });

    await expect(
      service.suspend(COMPANY, "reason enough", CTX),
    ).rejects.toBeInstanceOf(BusinessException);
  });

  it("refuses a company that does not exist", async () => {
    const { service } = makeService({ company: null });

    await expect(
      service.suspend(COMPANY, "reason enough", CTX),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("records the reason, and no credential", async () => {
    const { service, audited } = makeService({
      users: [
        {
          id: "u1",
          status: UserStatus.ACTIVE,
          statusBeforeCompanySuspension: null,
        },
      ],
    });

    await service.suspend(COMPANY, "fraud investigation", CTX);

    expect(audited.map((entry) => entry.action)).toEqual(["COMPANY_SUSPENDED"]);
    expect(audited[0].payload.reason).toBe("fraud investigation");
    const serialised = JSON.stringify(audited);
    expect(serialised).not.toContain("passwordHash");
    expect(serialised).not.toContain("token");
  });
});

describe("reactivating returns ONLY the people the suspension took", () => {
  it("restores a user the company suspension moved", async () => {
    const { service, users } = makeService({
      company: { verificationStatus: CompanyVerificationStatus.SUSPENDED },
      users: [
        {
          id: "u1",
          status: UserStatus.SUSPENDED,
          statusBeforeCompanySuspension: UserStatus.ACTIVE,
        },
      ],
      suspendedFrom: CompanyVerificationStatus.VERIFIED,
    });

    const result = await service.reactivate(COMPANY, CTX);

    expect(result.usersRestored).toBe(1);
    expect(users.get("u1")!.status).toBe(UserStatus.ACTIVE);
    // The marker is cleared, so a later reactivation cannot move them
    // again.
    expect(users.get("u1")!.statusBeforeCompanySuspension).toBeNull();
  });

  it("does NOT touch a user suspended for an unrelated reason", async () => {
    // THE MISTAKE THIS EXISTS TO PREVENT: setting everyone to ACTIVE
    // would reinstate an account somebody suspended on purpose.
    const { service, users } = makeService({
      company: { verificationStatus: CompanyVerificationStatus.SUSPENDED },
      users: [
        {
          id: "u1",
          status: UserStatus.SUSPENDED,
          statusBeforeCompanySuspension: UserStatus.ACTIVE,
        },
        {
          id: "u2",
          status: UserStatus.SUSPENDED,
          statusBeforeCompanySuspension: null,
        },
        {
          id: "u3",
          status: UserStatus.DISABLED,
          statusBeforeCompanySuspension: null,
        },
      ],
      suspendedFrom: CompanyVerificationStatus.VERIFIED,
    });

    const result = await service.reactivate(COMPANY, CTX);

    expect(result.usersRestored).toBe(1);
    expect(users.get("u2")!.status).toBe(UserStatus.SUSPENDED);
    expect(users.get("u3")!.status).toBe(UserStatus.DISABLED);
  });

  it("returns the company to what it was, not to VERIFIED", async () => {
    // A suspension is not a shortcut through verification: a company
    // suspended while still pending comes back pending.
    const { service } = makeService({
      company: { verificationStatus: CompanyVerificationStatus.SUSPENDED },
      suspendedFrom: CompanyVerificationStatus.PENDING_VERIFICATION,
    });

    const result = await service.reactivate(COMPANY, CTX);

    expect(result.verificationStatus).toBe(
      CompanyVerificationStatus.PENDING_VERIFICATION,
    );
  });

  it("falls back to PENDING when there is no record of what it was", async () => {
    // The state that grants nothing is the safe direction to be wrong
    // in.
    const { service } = makeService({
      company: { verificationStatus: CompanyVerificationStatus.SUSPENDED },
    });

    const result = await service.reactivate(COMPANY, CTX);

    expect(result.verificationStatus).toBe(
      CompanyVerificationStatus.PENDING_VERIFICATION,
    );
  });

  it("refuses a company that is not suspended", async () => {
    const { service } = makeService({
      company: { verificationStatus: CompanyVerificationStatus.VERIFIED },
    });

    await expect(service.reactivate(COMPANY, CTX)).rejects.toBeInstanceOf(
      BusinessException,
    );
  });
});

describe("removal is refused by the SERVER, not by a disabled button", () => {
  it("refuses when anything holds the company", async () => {
    const { service } = makeService({
      eligible: false,
      blockers: [{ kind: "ORDERS", count: 12 }],
    });

    await expect(
      service.remove(COMPANY, "reason enough", CTX),
    ).rejects.toMatchObject({
      // Names what stopped it, so an operator reading the response
      // learns the same thing the screen would have told them.
      message: expect.stringContaining("ORDERS=12"),
    });
  });

  it("checks eligibility INSIDE the transaction", async () => {
    // Checked outside, an order placed in the gap between the check and
    // the delete would be orphaned — and `master_orders` has no foreign
    // key to catch it.
    const { service, trace, eligibility } = makeService({
      eligible: false,
      blockers: [{ kind: "ORDERS", count: 1 }],
    });

    await service.remove(COMPANY, "reason enough", CTX).catch(() => undefined);

    expect(eligibility.check).toHaveBeenCalled();
    expect(trace[0]).toBe("TX_BEGIN");
    expect(trace).not.toContain("COMPANY_DELETE");
  });

  it("deletes nothing at all when it refuses", async () => {
    const { service, users } = makeService({
      eligible: false,
      blockers: [{ kind: "BANK_ACCOUNTS", count: 1 }],
      users: [
        {
          id: "u1",
          status: UserStatus.ACTIVE,
          statusBeforeCompanySuspension: null,
        },
      ],
    });

    await service.remove(COMPANY, "reason enough", CTX).catch(() => undefined);

    expect(users.size).toBe(1);
  });

  it("removes the company and its dependants when nothing holds it", async () => {
    const { service, trace, users } = makeService({
      eligible: true,
      users: [
        {
          id: "u1",
          status: UserStatus.ACTIVE,
          statusBeforeCompanySuspension: null,
        },
      ],
    });

    const result = await service.remove(COMPANY, "never traded", CTX);

    expect(users.size).toBe(0);
    expect(trace).toContain("COMPANY_DELETE");
    expect(result.removed.users).toBe(1);
  });

  it("deletes children BEFORE the company, so nothing is orphaned", async () => {
    const { service, trace } = makeService({
      eligible: true,
      users: [
        {
          id: "u1",
          status: UserStatus.ACTIVE,
          statusBeforeCompanySuspension: null,
        },
      ],
    });

    await service.remove(COMPANY, "never traded", CTX);

    expect(trace.indexOf("USER_DELETE")).toBeLessThan(
      trace.indexOf("COMPANY_DELETE"),
    );
  });

  it("writes the record with the reason, and no secret", async () => {
    const { service, audited } = makeService({ eligible: true });

    await service.remove(COMPANY, "registered and never traded", CTX);

    expect(audited.map((entry) => entry.action)).toEqual(["COMPANY_DELETED"]);
    expect(audited[0].payload.reason).toBe("registered and never traded");

    const serialised = JSON.stringify(audited);
    for (const forbidden of ["passwordHash", "token", "objectKey", "iban"]) {
      expect(serialised).not.toContain(forbidden);
    }
  });

  it("commits the record in the SAME transaction as the delete", async () => {
    // The company row and the line explaining its removal must not be
    // able to disagree about whether it happened.
    const { service, trace } = makeService({ eligible: true });

    await service.remove(COMPANY, "never traded", CTX);

    const begin = trace.indexOf("TX_BEGIN");
    const commit = trace.indexOf("TX_COMMIT");
    expect(trace.indexOf("AUDIT")).toBeGreaterThan(begin);
    expect(trace.indexOf("AUDIT")).toBeLessThan(commit);
  });

  it("drops the sessions of everyone who belonged to it", async () => {
    const { service, revoked } = makeService({
      eligible: true,
      users: [
        {
          id: "u1",
          status: UserStatus.ACTIVE,
          statusBeforeCompanySuspension: null,
        },
        {
          id: "u2",
          status: UserStatus.ACTIVE,
          statusBeforeCompanySuspension: null,
        },
      ],
    });

    await service.remove(COMPANY, "never traded", CTX);

    expect(revoked.sort()).toEqual(["u1", "u2"]);
  });

  it("refuses a company that does not exist", async () => {
    const { service } = makeService({ company: null });

    await expect(
      service.remove(COMPANY, "reason enough", CTX),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
