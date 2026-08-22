import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NotificationType as PrismaNotificationType } from "@prisma/client";
import {
  DEFAULT_NOTIFICATION_PAGE_SIZE,
  MAX_NOTIFICATION_PAGE_SIZE,
  MAX_PAGE_SIZE,
  NOTIFICATION_ENTITY_TYPES,
  NOTIFICATION_ITEM_KEYS,
  NOTIFICATION_PARAM_KEYS,
  NOTIFICATION_TYPES,
} from "@platform/types";

/**
 * The wire union and the Prisma enum must be exactly equal.
 *
 * The frontend consumes the union and never imports Prisma; without
 * this test the two drift silently and a producer writes a type the UI
 * cannot render. Asserting set equality — not containment — is what
 * makes an addition on either side fail.
 */
describe("NotificationType parity between Prisma and the wire contract", () => {
  const prismaValues = Object.values(PrismaNotificationType).sort();

  it("is the same set in both directions", () => {
    expect(prismaValues).toEqual([...NOTIFICATION_TYPES].sort());
  });

  it("has 18 members", () => {
    expect(NOTIFICATION_TYPES).toHaveLength(18);
    expect(prismaValues).toHaveLength(18);
  });

  it("contains no duplicates", () => {
    expect(new Set(NOTIFICATION_TYPES).size).toBe(NOTIFICATION_TYPES.length);
  });
});

describe("the params vocabulary stays closed and scalar", () => {
  it("is exactly the six agreed keys", () => {
    expect([...NOTIFICATION_PARAM_KEYS].sort()).toEqual(
      ["orderId", "allocationId", "disputeId", "amount", "currency", "count"].sort()
    );
  });

  it.each([
    "iban",
    "bankAccount",
    "externalTransferReference",
    "executedByAdminUserId",
    "email",
    "evidence",
    "snapshotData",
    "message",
    "reason",
  ])("never admits %s", (forbidden) => {
    expect(NOTIFICATION_PARAM_KEYS).not.toContain(forbidden);
  });

  it("admits no free-text field that could hold an exception message", () => {
    const freeText = ["message", "detail", "details", "description", "error", "note"];

    for (const field of freeText) expect(NOTIFICATION_PARAM_KEYS).not.toContain(field);
  });
});

describe("the item contract", () => {
  it("exposes exactly the agreed keys", () => {
    expect([...NOTIFICATION_ITEM_KEYS].sort()).toEqual(
      ["id", "type", "entityType", "entityId", "params", "createdAt", "readAt"].sort()
    );
  });

  it("carries no rendered text field", () => {
    for (const field of ["title", "body", "message", "subject", "htmlBody", "textBody"]) {
      expect(NOTIFICATION_ITEM_KEYS).not.toContain(field);
    }
  });

  it("carries no delivery or outbox notion", () => {
    for (const field of ["emailSent", "deliveredAt", "outboxEventId", "providerMode", "status"]) {
      expect(NOTIFICATION_ITEM_KEYS).not.toContain(field);
    }
  });

  it("carries no identity of the recipient or the company", () => {
    // The caller IS the recipient; echoing ids back adds nothing and
    // widens what a compromised client can enumerate.
    for (const field of ["userId", "companyId", "dedupeKey"]) {
      expect(NOTIFICATION_ITEM_KEYS).not.toContain(field);
    }
  });

  it("uses a closed entity vocabulary, so a link can be built safely", () => {
    expect([...NOTIFICATION_ENTITY_TYPES].sort()).toEqual(
      [
        "master_order",
        "order_allocation",
        "dispute",
        "replacement_obligation",
        "supplier_payout",
        // A payment can fail before any order exists, so the resumable
        // thing is the session — see NOTIFICATION_TYPE_ENTITY_TYPES.
        "checkout_session",
      ].sort()
    );
  });
});

describe("pagination bounds", () => {
  it("caps a notification page below the platform-wide ceiling", () => {
    // A notification list is a dropdown and a feed, never a bulk export.
    expect(MAX_NOTIFICATION_PAGE_SIZE).toBeLessThan(MAX_PAGE_SIZE);
    expect(MAX_NOTIFICATION_PAGE_SIZE).toBe(50);
  });

  it("defaults to a page smaller than the cap", () => {
    expect(DEFAULT_NOTIFICATION_PAGE_SIZE).toBeLessThanOrEqual(MAX_NOTIFICATION_PAGE_SIZE);
  });
});

describe("migration 90", () => {
  const MIGRATION = readFileSync(
    join(
      __dirname,
      "..",
      "..",
      "prisma",
      "migrations",
      "20260825000100_8d_create_notifications",
      "migration.sql"
    ),
    "utf8"
  );
  const sql = MIGRATION.replace(/--.*$/gm, "");

  it("creates the enum with all 18 values", () => {
    for (const type of NOTIFICATION_TYPES) {
      expect(sql).toContain(`'${type}'`);
    }
  });

  it("creates both tables", () => {
    expect(sql).toContain('CREATE TABLE "notifications"');
    expect(sql).toContain('CREATE TABLE "notification_recipients"');
  });

  it("enforces dedupe uniqueness in the DATABASE", () => {
    expect(sql).toContain('CREATE UNIQUE INDEX "notifications_dedupe_key_key"');
  });

  it("enforces one row per (notification, user)", () => {
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX "notification_recipients_notification_id_user_id_key"[\s\S]*?"notification_id", "user_id"/
    );
  });

  it("indexes the company feed and the unread badge", () => {
    expect(sql).toContain('"notifications_company_id_created_at_idx"');
    expect(sql).toContain('"notification_recipients_user_id_read_at_idx"');
  });

  it("alters no existing table and touches no existing row", () => {
    // Matched as STATEMENTS, not bare words: the foreign keys carry
    // `ON DELETE RESTRICT ON UPDATE CASCADE`, which is referential
    // policy, not data mutation.
    expect(sql).not.toMatch(/\bUPDATE\s+"?\w+"?\s+SET\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect(sql).not.toMatch(/ALTER TABLE "(users|companies|outbox_events)"[^;]*ADD COLUMN/);
  });

  it("creates no preferences table", () => {
    expect(sql).not.toMatch(/notification_preferences|notification_settings/);
  });

  it("adds no locale column to users", () => {
    expect(sql).not.toMatch(/preferred_locale|preferred_language/);
  });

  it("mentions no SMS, WhatsApp or push channel", () => {
    expect(sql).not.toMatch(/\bsms\b|whatsapp|push_token|device_token/i);
  });
});
