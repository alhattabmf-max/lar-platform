import { EmailVerificationStatus, Prisma } from "@prisma/client";
import { AuthService } from "./auth.service";
import { SETTINGS_KEYS } from "../settings/settings-keys.constants";

/**
 * THE ADDRESS A COMPANY IS REACHED ON, changed by the company itself.
 *
 * WHY THIS ENDPOINT EXISTS. «بيانات المنشأة» showed the email and could
 * only show it — an account registered with a typo in its address had
 * no way to correct it short of an administrator. The field is now
 * editable there, and this is what stands behind it.
 *
 * WHAT THESE PIN, in order of how much they would cost to get wrong:
 *
 *   1. A CHANGED ADDRESS IS UNVERIFIED. Proving control of the OLD
 *      mailbox says nothing about the new one, so the status goes back
 *      and a fresh token is issued.
 *   2. UNLESS VERIFICATION IS OFF PLATFORM-WIDE, in which case it is
 *      WAIVED exactly as a new registration's is — a PENDING status
 *      that nothing will ever clear would lock the account out.
 *   3. THE SAME ADDRESS IS A NO-OP. Re-submitting what is stored must
 *      not reset a VERIFIED status and post a token for a mailbox that
 *      was already proved.
 *   4. A TAKEN ADDRESS IS REFUSED NEUTRALLY, through the unique index
 *      rather than a read-then-write that two requests can both pass.
 */

const USER = {
  id: "user-1",
  companyId: "company-1",
  email: "owner@example.com",
  emailVerificationStatus: EmailVerificationStatus.VERIFIED,
};

function build({
  verificationEnabled = true,
  update = jest.fn(),
  user = USER,
}: {
  verificationEnabled?: boolean;
  update?: jest.Mock;
  user?: typeof USER;
} = {}) {
  const prisma = {
    user: {
      findUniqueOrThrow: jest.fn().mockResolvedValue(user),
      update,
    },
    emailVerificationToken: { create: jest.fn().mockResolvedValue({}) },
  };
  const settings = {
    getBoolean: jest.fn(async (key: string) =>
      key === SETTINGS_KEYS.EMAIL_VERIFICATION_ENABLED
        ? verificationEnabled
        : false,
    ),
  };
  const audit = { log: jest.fn() };
  const email = { sendEmail: jest.fn().mockResolvedValue(undefined) };

  // The order the service declares: prisma, audit, settings, policies,
  // verification, sessions, emailProvider.
  const service = new AuthService(
    prisma as never,
    audit as never,
    settings as never,
    {} as never,
    {} as never,
    {} as never,
    email as never,
  );

  return { service, prisma, settings, audit };
}

const CTX = { requestId: "req-1", ipAddress: "::1", userAgent: "jest" };

describe("changing the company's own email", () => {
  it("stores the NORMALISED address, not what was typed", async () => {
    const update = jest.fn().mockResolvedValue({
      ...USER,
      email: "new@example.com",
      emailVerificationStatus: EmailVerificationStatus.PENDING,
    });
    const { service } = build({ update });

    await service.changeEmail(USER.id, "  NEW@Example.COM  ", CTX as never);

    expect(update.mock.calls[0][0].data.email).toBe("new@example.com");
  });

  it("makes the new address UNVERIFIED and clears the date", async () => {
    const update = jest.fn().mockResolvedValue({
      ...USER,
      email: "new@example.com",
      emailVerificationStatus: EmailVerificationStatus.PENDING,
    });
    const { service, prisma } = build({ update });

    const result = await service.changeEmail(
      USER.id,
      "new@example.com",
      CTX as never,
    );

    expect(update.mock.calls[0][0].data.emailVerificationStatus).toBe(
      EmailVerificationStatus.PENDING,
    );
    expect(update.mock.calls[0][0].data.emailVerifiedAt).toBeNull();
    // And a token was posted for the NEW mailbox.
    expect(prisma.emailVerificationToken.create).toHaveBeenCalledTimes(1);
    expect(result.emailVerificationStatus).toBe(
      EmailVerificationStatus.PENDING,
    );
  });

  it("WAIVES it instead when verification is switched off platform-wide", async () => {
    // A PENDING status nothing will ever clear would lock the account
    // out; a new registration is WAIVED in exactly this case.
    const update = jest.fn().mockResolvedValue({
      ...USER,
      email: "new@example.com",
      emailVerificationStatus: EmailVerificationStatus.WAIVED,
    });
    const { service, prisma } = build({ verificationEnabled: false, update });

    await service.changeEmail(USER.id, "new@example.com", CTX as never);

    expect(update.mock.calls[0][0].data.emailVerificationStatus).toBe(
      EmailVerificationStatus.WAIVED,
    );
    expect(prisma.emailVerificationToken.create).not.toHaveBeenCalled();
  });

  it("does NOTHING when the address is the one already stored", async () => {
    // Re-submitting must not reset a verified status and post a token
    // for a mailbox that was already proved.
    const update = jest.fn();
    const { service, prisma, audit } = build({ update });

    const result = await service.changeEmail(
      USER.id,
      "Owner@Example.com",
      CTX as never,
    );

    expect(update).not.toHaveBeenCalled();
    expect(prisma.emailVerificationToken.create).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
    expect(result.emailVerificationStatus).toBe(
      EmailVerificationStatus.VERIFIED,
    );
  });

  it("refuses a taken address through the unique index, neutrally", async () => {
    // Two requests can both read a free address; only one may take it.
    const update = jest.fn().mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "5.22.0",
        meta: { target: ["email"] },
      }),
    );
    const { service } = build({ update });

    await expect(
      service.changeEmail(USER.id, "taken@example.com", CTX as never),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("names the field that collided, and never whose it is", async () => {
    const update = jest.fn().mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "5.22.0",
        meta: { target: ["email"] },
      }),
    );
    const { service } = build({ update });

    try {
      await service.changeEmail(USER.id, "taken@example.com", CTX as never);
      throw new Error("expected a refusal");
    } catch (error) {
      const body = (error as { getResponse(): { message: string } }).getResponse();
      // THE FIELD IS NAMED NOW, by the owner's decision — and the
      // person is signed in and editing their own record, so saying
      // the address is taken reveals nothing they could not learn by
      // trying to register it. WHAT IS STILL REFUSED is any hint of
      // WHOSE it is: no company, no name, no address in the body.
      const full = JSON.stringify(body);
      expect(full).not.toMatch(/taken by|belongs to|@/i);
      expect((body as unknown as { code: string }).code).toBe("EMAIL_TAKEN");
    }
  });

  it("records THAT it changed, and never the addresses themselves", async () => {
    // An audit row is read by administrators and exported.
    const update = jest.fn().mockResolvedValue({
      ...USER,
      email: "new@example.com",
      emailVerificationStatus: EmailVerificationStatus.PENDING,
    });
    const { service, audit } = build({ update });

    await service.changeEmail(USER.id, "new@example.com", CTX as never);

    expect(audit.log).toHaveBeenCalledTimes(1);
    const entry = JSON.stringify(audit.log.mock.calls[0][0]);
    expect(entry).toContain("USER_EMAIL_CHANGED");
    expect(entry).not.toContain("new@example.com");
    expect(entry).not.toContain("owner@example.com");
  });
});
