import { PrismaClient } from "@prisma/client";

/**
 * THE CHECK CONSTRAINT KNOWS EVERY STATUS THE ENUM HAS.
 *
 * `20260902080000_fulfilment_waits_for_funding` added `AWAITING_FUNDING`
 * to `OrderAllocationStatus` and had the payment webhook create every
 * allocation in it — but left
 * `order_allocations_status_timestamp_consistency` enumerating the five
 * statuses that existed before. A row matching none of its branches
 * fails the CHECK, so the first successful payment on any group offer
 * was refused inside the webhook's own transaction.
 *
 * WHY THIS SPEC EXISTS BESIDE THE ONE THAT ALREADY COVERED IT.
 * `payment-webhook-success.integration-spec.ts` asserts the allocation's
 * status and would have caught this — but only by driving a whole
 * payment. This one asks the database directly, so the next value added
 * to the enum is checked against the constraint by a test that names
 * that as its subject, not as a side effect of a webhook.
 *
 * IT READS THE DEPLOYED CONSTRAINT, never a copy of its text. A copy
 * would keep passing after the real one drifted, which is precisely the
 * failure mode being guarded against.
 */

const prisma = new PrismaClient();

const CONSTRAINT = "order_allocations_status_timestamp_consistency";

async function constraintExpression(): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<{ def: string }[]>(`
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = 'order_allocations'::regclass AND conname = '${CONSTRAINT}'
  `);
  if (rows.length === 0) throw new Error(`${CONSTRAINT} is not on the table`);
  // `CHECK ((...))` -> `(...)`, so it can be evaluated as an expression.
  return rows[0].def.replace(/^CHECK\s*\(\(/, "(").replace(/\)\)$/, ")");
}

/** Evaluates the LIVE constraint against one hypothetical row. */
async function accepts(row: {
  status: string;
  preparation_due_at: string | null;
  preparation_started_at: string | null;
  ready_to_ship_at: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
}): Promise<boolean> {
  const expr = await constraintExpression();
  const ts = (value: string | null) => (value === null ? "NULL::timestamptz" : `'${value}'::timestamptz`);
  const result = await prisma.$queryRawUnsafe<{ passes: boolean }[]>(`
    WITH candidate AS (
      SELECT '${row.status}'::"OrderAllocationStatus" AS status,
             ${ts(row.preparation_due_at)} AS preparation_due_at,
             ${ts(row.preparation_started_at)} AS preparation_started_at,
             ${ts(row.ready_to_ship_at)} AS ready_to_ship_at,
             ${ts(row.shipped_at)} AS shipped_at,
             ${ts(row.delivered_at)} AS delivered_at
    )
    SELECT ${expr} AS passes FROM candidate
  `);
  return result[0].passes;
}

const EMPTY = {
  preparation_due_at: null,
  preparation_started_at: null,
  ready_to_ship_at: null,
  shipped_at: null,
  delivered_at: null,
};

describe("order_allocations status CHECK (integration, real DB)", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("accepts the row the payment webhook actually creates", async () => {
    // Exactly what `payment-webhook.service.ts` writes for a group
    // offer: waiting for the target, with no clock running.
    await expect(accepts({ status: "AWAITING_FUNDING", ...EMPTY })).resolves.toBe(true);
  });

  it("names every value the enum has, so none can be added without one", async () => {
    const values = await prisma.$queryRawUnsafe<{ value: string }[]>(`
      SELECT unnest(enum_range(NULL::"OrderAllocationStatus"))::text AS value
    `);
    const def = await constraintExpression();

    // A status the constraint never mentions can satisfy no branch of
    // it, so no row may ever hold that status — an enum value that
    // exists and cannot be used.
    for (const { value } of values) {
      expect([value, def.includes(value)]).toEqual([value, true]);
    }
  });

  it("refuses an allocation that awaits funding while already holding a deadline", async () => {
    // NULL is what «not yet permitted» is written as. A row claiming
    // both would be a contradiction, and the mutation trigger guards
    // only UPDATEs — an INSERT never reaches it.
    await expect(
      accepts({ ...EMPTY, status: "AWAITING_FUNDING", preparation_due_at: "2026-01-01T00:00:00Z" })
    ).resolves.toBe(false);
  });

  it("still refuses the shapes it always refused", async () => {
    // The repair added a branch; it did not loosen the five that were
    // already right.
    await expect(
      accepts({ ...EMPTY, status: "PREPARING" })
    ).resolves.toBe(false);
    await expect(
      accepts({ ...EMPTY, status: "DELIVERED", delivered_at: "2026-01-01T00:00:00Z" })
    ).resolves.toBe(false);
  });
});
