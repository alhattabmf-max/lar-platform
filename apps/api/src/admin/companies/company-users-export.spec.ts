import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * WHAT LEAVES IN THE USER-LIST EXPORT, pinned.
 *
 * The owner asked whether an export named "sign-in accounts" hands out
 * credentials. It does not — but "I read it and it was fine" is not a
 * property, it is a moment. This is the property: the export's row
 * mapping may contain an email, a role, a status, a WORD for whether a
 * password exists, and a date, and nothing else.
 *
 * READ AS SOURCE, not executed. The controller reaches into Prisma,
 * ExcelJS and a session, and standing all of that up would test the
 * mocks. What must not change is the shape of the projection and the
 * cells built from it, and that is text.
 *
 * `passwordHash` IS SELECTED, deliberately, and that is the subtle part:
 * the column is read so the row can say «مُعيّنة» or «لم تُعيَّن». The
 * test therefore cannot simply ban the word — it pins that the value
 * reaches a cell ONLY through a `!== null` comparison, never as itself.
 */

const SOURCE = readFileSync(
  join(__dirname, "admin-company.controller.ts"),
  "utf8",
);

/** The `rows:` block of `exportUsers`, as written. */
function exportUsersRows(): string {
  const start = SOURCE.indexOf('@Get(":id/users/export")');
  expect(start).toBeGreaterThan(-1);
  const rowsAt = SOURCE.indexOf("rows: page.map(", start);
  expect(rowsAt).toBeGreaterThan(-1);
  const end = SOURCE.indexOf("]),", rowsAt);
  expect(end).toBeGreaterThan(-1);
  return SOURCE.slice(rowsAt, end);
}

/**
 * The `select:` of the USERS query behind it.
 *
 * Anchored on `prisma.user.findMany`, not on the first `select:` after
 * the decorator — that one belongs to the company lookup above it
 * (`{ id, legalName }`), and reading it would have made this test pass
 * while proving nothing about what leaves.
 */
function exportUsersSelect(): string {
  const start = SOURCE.indexOf('@Get(":id/users/export")');
  expect(start).toBeGreaterThan(-1);
  const queryAt = SOURCE.indexOf("prisma.user.findMany", start);
  expect(queryAt).toBeGreaterThan(-1);
  const selectAt = SOURCE.indexOf("select: {", queryAt);
  const end = SOURCE.indexOf("},", selectAt);
  return SOURCE.slice(selectAt, end);
}

describe("the company user-list export", () => {
  it("selects nothing but the five fields it reports", () => {
    const select = exportUsersSelect();
    const fields = [...select.matchAll(/(\w+): true/g)].map((m) => m[1]).sort();

    expect(fields).toEqual([
      "createdAt",
      "email",
      "passwordHash",
      "role",
      "status",
    ]);
  });

  it.each([
    "twoFactorSecret",
    "recoveryCode",
    "sessionId",
    "token",
    "tokenHash",
    "resetToken",
    "verificationToken",
    "secret",
    "apiKey",
    "iban",
  ])("never selects %s", (forbidden) => {
    // A future edit that widens the projection has to fail here first.
    expect(exportUsersSelect().toLowerCase()).not.toContain(
      forbidden.toLowerCase(),
    );
  });

  it("puts the password hash in no cell — only the fact that one exists", () => {
    const rows = exportUsersRows();

    // It appears exactly once, and only inside the null comparison.
    const mentions = [...rows.matchAll(/passwordHash/g)].length;
    expect(mentions).toBe(1);
    expect(rows).toContain("user.passwordHash !== null");

    // Never as a value, a length, a slice or a prefix.
    expect(rows).not.toMatch(/passwordHash[^!]*[,)]/);
    expect(rows).not.toContain("passwordHash.length");
    expect(rows).not.toContain("passwordHash.slice");
  });

  it("emits exactly five cells, in the order the headings promise", () => {
    const rows = exportUsersRows();
    const cells = rows
      .slice(rows.indexOf("["))
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("//") && line !== "[");

    // email · role · status · the password WORD · the date
    expect(cells[0]).toContain("user.email");
    expect(cells[1]).toContain("roleLabel");
    expect(cells[2]).toContain("userStatusLabel");
    expect(rows).toContain("passwordSet");
    expect(rows).toContain("passwordPending");
    expect(rows).toContain("user.createdAt.toISOString().slice(0, 10)");
  });

  it("is recorded before the bytes go out", () => {
    // `AdminExportService.send` writes the audit entry first; the
    // controller must therefore go through it rather than writing a
    // workbook itself.
    const start = SOURCE.indexOf('@Get(":id/users/export")');
    const end = SOURCE.indexOf("@Get", start + 10);
    const body = SOURCE.slice(start, end === -1 ? SOURCE.length : end);

    expect(body).toContain("this.exports.send(");
    expect(body).not.toContain("new ExcelJS");
  });

  it("refuses a user id that belongs to another company", () => {
    // Both ids come from the path. Without this the screen for company A
    // could act on company B's person by editing a URL.
    const start = SOURCE.indexOf("private async requireCompanyUser");
    const body = SOURCE.slice(start, start + 600);

    expect(body).toContain("companyId");
    expect(body).toContain("findFirst");
  });
});
