import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The PAID ⇒ masterOrderId invariant, proved at its source.
 *
 * `CheckoutSessionView` is a discriminated union in which `PAID`
 * guarantees a `masterOrderId`. That guarantee is only as good as the
 * write path behind it: if the capture marked the session PAID on one
 * connection and created the MasterOrder on another, a reader could
 * legitimately observe PAID with no order, and the union would be a
 * lie the type system was enforcing.
 *
 * WHAT THIS SUITE IS, precisely.
 *
 * It is a STRUCTURAL test. It reads the service's source and asserts
 * that the PAID update, the `masterOrder.create`, the notification
 * writes and the outbox writes all name the same `tx` binding, that
 * nothing inside the transaction reaches around it to `this.prisma`,
 * and that the whole webhook opens exactly one transaction.
 *
 * It is NOT a proof of PostgreSQL runtime atomicity. It does not start
 * a transaction, does not fail one mid-way, and does not observe a
 * rollback. It would still pass if the isolation level were wrong, if
 * a statement reached the database through a path these patterns do
 * not see, or if a deferred constraint fired at COMMIT and left
 * earlier writes behind.
 *
 * What it is genuinely good at is catching the next person who adds a
 * write on the wrong client — the most likely way this invariant
 * actually breaks — and it does that on every commit, with no database.
 *
 * The runtime proof lives in
 * `test/payment-webhook-rollback.integration-spec.ts`, which forces a
 * failure at the end of the capture and asserts that nothing survives.
 * That suite needs a real PostgreSQL and is currently
 * WRITTEN — NOT EXECUTED — STATUS UNKNOWN.
 */

const SOURCE = readFileSync(join(__dirname, "payment-webhook.service.ts"), "utf8");

/** Comments describe the rules; they must not be mistaken for the code that keeps them. */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/**
 * The body of the success path, which is where the PAID transition and
 * the order creation both live.
 */
function successPathBody(): string {
  const start = CODE.indexOf("private async handleSuccessEvent");
  expect(start).toBeGreaterThan(-1);
  const rest = CODE.slice(start);
  // Up to the next method at class-body indentation.
  const end = rest.indexOf("\n  private async ", 1);
  const alt = rest.indexOf("\n  async ", 1);
  const stop = [end, alt].filter((i) => i > 0).sort((a, b) => a - b)[0] ?? rest.length;
  return rest.slice(0, stop);
}

describe("payment webhook — capture atomicity (structural, source-level)", () => {
  const BODY = successPathBody();

  it("takes a transaction client as its argument rather than opening its own", () => {
    // The caller owns the transaction. A method that opened its own
    // would commit independently of the idempotency claim above it.
    expect(CODE).toMatch(/private async handleSuccessEvent\(\s*tx: Prisma\.TransactionClient/);
    expect(BODY).not.toContain("$transaction(");
  });

  it("marks the session PAID and creates the MasterOrder on the same client", () => {
    expect(BODY).toMatch(/tx\.\$executeRaw`[\s\S]*?UPDATE checkout_sessions SET status = 'PAID'/);
    expect(BODY).toMatch(/await tx\.masterOrder\.create\(/);

    const paidAt = BODY.search(/UPDATE checkout_sessions SET status = 'PAID'/);
    const orderAt = BODY.search(/tx\.masterOrder\.create\(/);
    expect(paidAt).toBeGreaterThan(-1);
    expect(orderAt).toBeGreaterThan(paidAt);
  });

  it("writes the notifications on the same client too", () => {
    // A notification committed outside the capture's transaction can
    // outlive a rollback: the trader is told they paid for an order
    // that no longer exists.
    expect(BODY).toMatch(/this\.notifications\.paymentSucceeded\(\s*tx,/);
    expect(BODY).toMatch(/this\.notifications\.orderCreated\(\s*tx,/);
  });

  it("writes the outbox events on the same client too", () => {
    const outboxCalls = BODY.match(/\w+(?:\.\w+)*\.outboxEvent\.create\(/g) ?? [];
    for (const call of outboxCalls) {
      expect(call).toBe("tx.outboxEvent.create(");
    }
  });

  it("never reaches around the transaction to the pooled client", () => {
    // `this.prisma.x` inside the transaction body runs on a DIFFERENT
    // connection: it commits on its own and survives the rollback of
    // everything around it. This is the single assertion that keeps
    // the whole capture atomic.
    const escapes = BODY.match(/this\.prisma\.\w+/g) ?? [];
    expect(escapes).toEqual([]);
  });

  it("opens exactly one transaction for the whole webhook", () => {
    // Two transactions would mean two commit points, and a crash
    // between them leaves precisely the partial state the union
    // declares impossible.
    const transactions = CODE.match(/\$transaction\(/g) ?? [];
    expect(transactions).toHaveLength(1);
    expect(CODE).toMatch(/async handleWebhook\([\s\S]*?this\.prisma\.\$transaction\(async \(tx\)/);
  });

  it("routes the whole event through the transaction client it was given", () => {
    expect(CODE).toMatch(/await this\.processEventTx\(tx, parsed\)/);
    expect(CODE).toMatch(/private async processEventTx\(tx: Prisma\.TransactionClient/);
  });

  it("uses the provider's captured timestamp for the PAID transition, not now()", () => {
    // now() would be the time the webhook was processed, which drifts
    // from the capture on every retry and redelivery.
    expect(BODY).toMatch(/status = 'PAID', captured_at = \$\{capturedAt\}/);
  });
});
