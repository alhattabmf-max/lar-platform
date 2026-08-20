import { readFileSync } from "fs";

describe("runCheckoutLockExpirySweep — structural isolation (source-level)", () => {
  it("the checkout lock expiry sweep's SQL never references any table other than checkout_sessions/audit_logs/outbox_events", () => {
    const rawSource = readFileSync(
      require.resolve("@platform/opportunity-lifecycle/dist/checkout-lock-expiry-sweep.js"),
      "utf-8"
    );
    const source = rawSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const allowedTables = ["checkout_sessions", "audit_logs", "outbox_events", "batch"];
    const tableMentions = source.match(/(?<!FOR )(?:FROM|JOIN|UPDATE|INTO)\s+"?(\w+)"?/gi) ?? [];
    for (const mention of tableMentions) {
      const table = mention
        .replace(/(?:FROM|JOIN|UPDATE|INTO)\s+"?/i, "")
        .replace(/"$/, "")
        .toLowerCase();
      if (table === "skip") continue;
      expect(allowedTables).toContain(table);
    }
  });

  it("this sweep never references opportunities — it must never touch fundedQuantity or any opportunity field", () => {
    const rawSource = readFileSync(
      require.resolve("@platform/opportunity-lifecycle/dist/checkout-lock-expiry-sweep.js"),
      "utf-8"
    );
    const source = rawSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(source).not.toMatch(/\bopportunities\b/i);
    expect(source).not.toMatch(/funded_quantity/i);
  });
});
