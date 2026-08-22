import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NOTIFICATION_TYPES, emitsEmail, type NotificationType } from "@platform/types";
import { NOTIFICATION_MATRIX } from "./notification-matrix";

/**
 * The plan's recipient matrix must agree with the code's.
 *
 * These two drifted once already. The plan said six types went to "trader +
 * supplier"; Option A narrowed every type to exactly ONE target company, and
 * the document was not updated — so for a while the plan described a system
 * that did not exist. That is how the next batch gets built against the wrong
 * assumption, and a recipient assumption is a counterparty-leak assumption.
 *
 * PARSING, NOT MATCHING. The plan is prose in Markdown, and a test that pinned
 * its exact text would fail on a reworded sentence or a changed column width —
 * a brittle test that gets deleted rather than fixed. So this extracts the
 * table by its STRUCTURE (a row per notification type, cells split on `|`) and
 * compares only the two things that carry meaning: who receives it, and whether
 * it emits an email. Bold markers, spacing and column order are normalised
 * away.
 *
 * `NOTIFICATION_MATRIX` is authoritative. If they disagree, the DOCUMENT is
 * what is wrong.
 */

const PLAN = readFileSync(
  join(__dirname, "..", "..", "..", "..", "docs", "PHASE_8_IMPLEMENTATION_PLAN.md"),
  "utf8"
);

/** Strips emphasis, backticks and padding so a reworded cell still parses. */
function normaliseCell(cell: string): string {
  return cell
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .trim()
    .toLowerCase();
}

interface PlanRow {
  recipients: Set<"trader" | "supplier">;
  emitsEmail: boolean;
}

/**
 * Reads the matrix rows out of the plan.
 *
 * A row is any table line naming a known `NotificationType` in its third cell.
 * That is the whole contract with the document's formatting: the type appears
 * in a table row. Everything else about how it is written is free to change.
 */
function parsePlanMatrix(): Map<NotificationType, PlanRow> {
  const rows = new Map<NotificationType, PlanRow>();

  for (const line of PLAN.split("\n")) {
    if (!line.trimStart().startsWith("|")) continue;

    const cells = line.split("|").map(normaliseCell);
    const type = NOTIFICATION_TYPES.find((t) => cells.includes(t.toLowerCase()));
    if (!type) continue;

    // Found by CONTENT rather than by index, so inserting a column does not
    // break this — but matched EXACTLY, not by containment. Two other columns
    // mention a party in passing: the type name
    // (`DISPUTE_SUPPLIER_RESPONDED`, which goes to the trader) and the
    // business-event description ("Supplier responded"). Either would be read
    // as a recipient by a looser match.
    const PARTY_CELLS = new Set(["trader", "supplier", "trader + supplier"]);
    const recipientCell = cells.find((c) => PARTY_CELLS.has(c));
    const emailCell = cells.find((c) => c === "yes" || c === "no" || c === "yes (both)");
    if (recipientCell === undefined || emailCell === undefined) continue;

    const recipients = new Set<"trader" | "supplier">();
    if (recipientCell.includes("trader")) recipients.add("trader");
    if (recipientCell.includes("supplier")) recipients.add("supplier");

    rows.set(type, { recipients, emitsEmail: emailCell.startsWith("yes") });
  }

  return rows;
}

const planMatrix = parsePlanMatrix();

describe("the plan's notification matrix parses at all", () => {
  it("finds a row for every one of the 18 types", () => {
    // If this fails the parser has lost the table, and every assertion below
    // would pass vacuously.
    expect([...planMatrix.keys()].sort()).toEqual([...NOTIFICATION_TYPES].sort());
  });
});

describe("the plan agrees with the implemented matrix", () => {
  it.each(NOTIFICATION_TYPES)("%s targets the same company in both", (type) => {
    const planned = planMatrix.get(type);
    expect(planned).toBeDefined();

    const implemented = NOTIFICATION_MATRIX[type].targetCompany.toLowerCase();

    // Option A: exactly one target per type. A plan row naming two parties
    // describes a design this code does not implement.
    expect([type, [...planned!.recipients].sort()]).toEqual([type, [implemented]]);
  });

  it.each(NOTIFICATION_TYPES)("%s agrees on whether it emits an email", (type) => {
    const planned = planMatrix.get(type);
    expect(planned).toBeDefined();

    // The code's channel is the source of truth; `emitsEmail` is derived from
    // the shared contract's own list, so this pins three things to each other.
    const implemented = NOTIFICATION_MATRIX[type].channel === "EMAIL_AND_IN_APP";

    expect([type, planned!.emitsEmail]).toEqual([type, implemented]);
    expect([type, emitsEmail(type)]).toEqual([type, implemented]);
  });
});

describe("the plan records Option A rather than the superseded draft", () => {
  it("names the decision and its consequence for 8E", () => {
    // Prose, so this checks that the SUBJECT is present — not the wording.
    expect(PLAN).toMatch(/Option A/);
    expect(PLAN).toMatch(/212/);
  });

  it("has no TABLE ROW claiming a type reaches both parties", () => {
    // Scoped to the rows, not the prose: the Option A section quotes the
    // superseded wording to explain what changed, which is exactly the kind of
    // sentence a raw substring check would forbid for no reason.
    for (const [type, row] of planMatrix) {
      expect([type, row.recipients.size]).toEqual([type, 1]);
    }
  });

  it("still records that the mock provider sends nothing", () => {
    expect(PLAN).toMatch(/EMAIL_PROVIDER_MODE=mock/);
    expect(PLAN).toMatch(/sends\s*\n?\s*nothing|nothing is sent at all/);
  });
});
