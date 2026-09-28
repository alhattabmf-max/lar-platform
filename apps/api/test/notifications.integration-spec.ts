import { PrismaClient } from "@prisma/client";
import { RELAY_SUPPORTED_EVENT_TYPES, validateEmailNotificationV1 } from "@platform/email";
import { NotificationWriterService, buildDedupeKey } from "../src/notifications/notification-writer.service";
import { uniqueMobile } from "./fixtures/unique";

/**
 * STATUS: WRITTEN — NOT EXECUTED — STATUS UNKNOWN.
 *
 * Requires PostgreSQL with migration 90 applied. Port 5432 is closed on
 * this machine, so none of these has run.
 *
 * They cover what unit tests structurally cannot: that the unique
 * indexes actually collide under concurrency, that the three writes are
 * one atomic unit, and that a rollback leaves nothing behind.
 */

const prisma = new PrismaClient();
const writer = new NotificationWriterService();

const EMAIL_EVENT = RELAY_SUPPORTED_EVENT_TYPES[0];

async function seedCompanyWithUsers(count: number) {
  // Company carries no city — location lives on CompanyLocation, which
  // these tests do not need.
  const company = await prisma.company.create({
    data: {
      crNumber: `CR-NOTIF-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      legalName: "Notification Test Co",
      accountType: "TRADER",
    },
  });

  const users = [];
  for (let i = 0; i < count; i++) {
    users.push(
      await prisma.user.create({
        data: {
          companyId: company.id,
          email: `notif-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}@example.com`,
          passwordHash: "x",
          primaryMobile1: uniqueMobile(),
          primaryMobile2: uniqueMobile(),
          status: "ACTIVE",
        },
      })
    );
  }

  return { company, users };
}

const emitInput = (companyId: string, entityId: string) => ({
  companyId,
  type: "ORDER_CREATED" as const,
  entityType: "master_order" as const,
  entityId,
  params: { orderId: entityId },
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("the three writes are one atomic unit", () => {
  it("creates notification, recipients and email intents together", async () => {
    const { company, users } = await seedCompanyWithUsers(2);
    const entityId = crypto.randomUUID();

    const result = await prisma.$transaction((tx) =>
      writer.emit(tx, { ...emitInput(company.id, entityId), type: "PAYMENT_SUCCEEDED", params: {} })
    );

    expect(result.created).toBe(true);
    expect(result.recipientsCreated).toBe(2);
    expect(result.emailIntentsCreated).toBe(2);

    const recipients = await prisma.notificationRecipient.findMany({
      where: { notificationId: result.notificationId! },
    });
    expect(recipients.map((r) => r.userId).sort()).toEqual(users.map((u) => u.id).sort());
  });

  it("a rollback leaves none of the three", async () => {
    const { company, users } = await seedCompanyWithUsers(1);
    const entityId = crypto.randomUUID();

    await expect(
      prisma.$transaction(async (tx) => {
        await writer.emit(tx, {
          ...emitInput(company.id, entityId),
          type: "PAYMENT_SUCCEEDED",
          params: {},
        });
        throw new Error("business failure after the notification");
      })
    ).rejects.toThrow();

    const dedupeKey = buildDedupeKey({
      type: "PAYMENT_SUCCEEDED",
      entityType: "master_order",
      entityId,
    });
    expect(await prisma.notification.findUnique({ where: { dedupeKey } })).toBeNull();
    // AND NO EMAIL INTENT SURVIVED EITHER.
    //
    // This asserted `count(...) >= 0`, which is true of every count
    // that ever ran — and the filter it counted, `path: ["notificationId"],
    // not: undefined`, is not a Prisma JSON filter at all. The test
    // said nothing, and could not have failed.
    //
    // The intent rows carry no entityId, but they do carry the
    // recipient, and this company and its user were created for this
    // test alone — so an intent naming that user could only have come
    // from the transaction that was rolled back.
    const survivingIntents = await prisma.outboxEvent.count({
      where: {
        eventType: EMAIL_EVENT,
        payload: { path: ["recipientUserId"], equals: users[0].id },
      },
    });
    expect(survivingIntents).toBe(0);
  });
});

describe("deduplication under concurrency", () => {
  it("two concurrent writers produce exactly one notification", async () => {
    const other = new PrismaClient();
    try {
      const { company } = await seedCompanyWithUsers(1);
      const entityId = crypto.randomUUID();

      const results = await Promise.allSettled([
        prisma.$transaction((tx) => writer.emit(tx, emitInput(company.id, entityId))),
        other.$transaction((tx) => writer.emit(tx, emitInput(company.id, entityId))),
      ]);

      // Neither transaction may fail: a unique violation must be
      // absorbed by ON CONFLICT, not raised into the caller.
      expect(results.every((r) => r.status === "fulfilled")).toBe(true);

      const created = results
        .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof writer.emit>>> => r.status === "fulfilled")
        .filter((r) => r.value.created);
      expect(created).toHaveLength(1);

      const dedupeKey = buildDedupeKey({
        type: "ORDER_CREATED",
        entityType: "master_order",
        entityId,
      });
      const rows = await prisma.notification.findMany({ where: { dedupeKey } });
      expect(rows).toHaveLength(1);
    } finally {
      await other.$disconnect();
    }
  });

  it("a repeat emit creates no second recipient or email intent", async () => {
    const { company } = await seedCompanyWithUsers(2);
    const entityId = crypto.randomUUID();
    const args = { ...emitInput(company.id, entityId), type: "PAYMENT_SUCCEEDED" as const, params: {} };

    const first = await prisma.$transaction((tx) => writer.emit(tx, args));
    const second = await prisma.$transaction((tx) => writer.emit(tx, args));

    expect(second.created).toBe(false);
    expect(second.recipientsCreated).toBe(0);
    expect(second.emailIntentsCreated).toBe(0);

    expect(
      await prisma.notificationRecipient.count({ where: { notificationId: first.notificationId! } })
    ).toBe(2);
  });
});

describe("per-user read state is independent", () => {
  it("one colleague's read does not clear another's unread", async () => {
    const { company, users } = await seedCompanyWithUsers(2);
    const entityId = crypto.randomUUID();

    const result = await prisma.$transaction((tx) =>
      writer.emit(tx, emitInput(company.id, entityId))
    );

    await prisma.$executeRaw`
      UPDATE notification_recipients SET read_at = now()
      WHERE notification_id = ${result.notificationId!}::uuid AND user_id = ${users[0].id}::uuid
    `;

    const a = await prisma.notificationRecipient.findFirstOrThrow({
      where: { notificationId: result.notificationId!, userId: users[0].id },
    });
    const b = await prisma.notificationRecipient.findFirstOrThrow({
      where: { notificationId: result.notificationId!, userId: users[1].id },
    });

    expect(a.readAt).not.toBeNull();
    expect(b.readAt).toBeNull();
  });
});

describe("another company cannot probe a notification", () => {
  it("finds nothing when scoped to a different company", async () => {
    const mine = await seedCompanyWithUsers(1);
    const theirs = await seedCompanyWithUsers(1);
    const entityId = crypto.randomUUID();

    const result = await prisma.$transaction((tx) =>
      writer.emit(tx, emitInput(mine.company.id, entityId))
    );

    const probed = await prisma.notificationRecipient.findFirst({
      where: {
        notificationId: result.notificationId!,
        userId: theirs.users[0].id,
        notification: { companyId: theirs.company.id },
      },
    });

    expect(probed).toBeNull();
  });
});

describe("the relay reads the intent without joining notifications", () => {
  it("writes a payload the relay's own validator accepts", async () => {
    const { company } = await seedCompanyWithUsers(1);
    const entityId = crypto.randomUUID();

    const result = await prisma.$transaction((tx) =>
      writer.emit(tx, {
        ...emitInput(company.id, entityId),
        type: "PAYMENT_SUCCEEDED",
        params: { orderId: entityId, amount: "12.50", currency: "SAR" },
      })
    );

    const intents = await prisma.outboxEvent.findMany({
      where: { eventType: EMAIL_EVENT, idempotencyKey: { startsWith: `email:v1:${result.notificationId}` } },
    });

    expect(intents).toHaveLength(1);
    expect(validateEmailNotificationV1(intents[0].payload).ok).toBe(true);
    expect(intents[0].status).toBe("PENDING");
  });

  it("stores no email address in the intent", async () => {
    const { company } = await seedCompanyWithUsers(1);
    const entityId = crypto.randomUUID();

    const result = await prisma.$transaction((tx) =>
      writer.emit(tx, { ...emitInput(company.id, entityId), type: "REFUND_INITIATED", params: {} })
    );

    const intent = await prisma.outboxEvent.findFirstOrThrow({
      where: { idempotencyKey: { startsWith: `email:v1:${result.notificationId}` } },
    });

    expect(JSON.stringify(intent.payload)).not.toContain("@");
  });

  it("creates no intent for an in-app-only type", async () => {
    const { company } = await seedCompanyWithUsers(1);
    const entityId = crypto.randomUUID();

    const result = await prisma.$transaction((tx) =>
      writer.emit(tx, {
        companyId: company.id,
        type: "ALLOCATION_READY",
        entityType: "order_allocation",
        entityId,
        params: { orderId: entityId, allocationId: entityId },
      })
    );

    expect(result.emailIntentsCreated).toBe(0);
    expect(
      await prisma.outboxEvent.count({
        where: { idempotencyKey: { startsWith: `email:v1:${result.notificationId}` } },
      })
    ).toBe(0);
  });
});
