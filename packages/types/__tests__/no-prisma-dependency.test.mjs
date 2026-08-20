import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Structural guard for docs/PHASE_8_IMPLEMENTATION_PLAN.md §4:
// @platform/types holds wire contracts only. If it ever imported the
// database client, every consumer of the shared contracts — including
// apps/web — would be transitively coupled to it, and internal entity
// shapes (JournalEntry, LedgerPosting, snapshotData, AuditLog
// before/after payloads) would become reachable from the browser
// bundle's type surface.
//
// Comments are stripped before scanning: a comment explaining WHY a
// module is not imported is legitimate and must not trip the guard.
// What matters is the module specifier in real import/require/dynamic
// import syntax, which only survives comment stripping.
//
// Deliberately dependency-free (node:test + node:fs) so the guard itself
// cannot be defeated by a test-runner change.

const PKG_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const SRC = join(PKG_ROOT, "src");

/** Module specifiers that must never be reachable from this package. */
const FORBIDDEN_SPECIFIERS = ["@prisma/client", "prisma", "@nestjs/", "express", "ioredis"];

function stripComments(source) {
  // Block comments first, then line comments. Good enough for TypeScript
  // source that contains no regex/string literal holding "//" — and the
  // separate specifier assertion below would catch anything smuggled
  // through such a literal anyway.
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function moduleSpecifiers(source) {
  const code = stripComments(source);
  const specifiers = [];
  const patterns = [
    /\bfrom\s+["']([^"']+)["']/g,
    /\bimport\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) specifiers.push(match[1]);
  }
  return specifiers;
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

test("no source file imports Prisma, NestJS, or any server-only module", () => {
  const files = walk(SRC);
  assert.ok(files.length > 0, "expected to find source files to scan");

  for (const file of files) {
    const label = file.replace(PKG_ROOT, "@platform/types");
    for (const specifier of moduleSpecifiers(readFileSync(file, "utf8"))) {
      for (const forbidden of FORBIDDEN_SPECIFIERS) {
        const hit = forbidden.endsWith("/")
          ? specifier.startsWith(forbidden)
          : specifier === forbidden;
        assert.equal(hit, false, `${label} imports forbidden module "${specifier}"`);
      }
    }
  }
});

test("no source file reaches outside the package", () => {
  for (const file of walk(SRC)) {
    const label = file.replace(PKG_ROOT, "@platform/types");
    for (const specifier of moduleSpecifiers(readFileSync(file, "utf8"))) {
      assert.equal(
        specifier.startsWith("../../"),
        false,
        `${label} reaches outside the package via "${specifier}"`
      );
    }
  }
});

test("the comment stripper does not hide a real import", () => {
  // Guards the guard: a file that both mentions the module in prose and
  // actually imports it must still fail.
  const withCommentOnly = `// we never import @prisma/client here\nexport type A = string;`;
  const withRealImport = `// we never import @prisma/client here\nimport { X } from "@prisma/client";`;

  assert.deepEqual(moduleSpecifiers(withCommentOnly), []);
  assert.deepEqual(moduleSpecifiers(withRealImport), ["@prisma/client"]);
});

test("package.json declares no runtime dependencies at all", () => {
  const pkg = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8"));

  assert.deepEqual(
    pkg.dependencies ?? {},
    {},
    "@platform/types must stay dependency-free — it is a pure contract package"
  );

  for (const dep of Object.keys(pkg.devDependencies ?? {})) {
    assert.equal(
      dep.startsWith("@prisma/") || dep === "prisma",
      false,
      `devDependency "${dep}" pulls Prisma into the contract package`
    );
  }
});

test("index re-exports both the error envelope and the contracts barrel", () => {
  const index = readFileSync(join(SRC, "index.ts"), "utf8");
  assert.match(index, /export \* from "\.\/error-envelope"/);
  assert.match(index, /export \* from "\.\/contracts"/);
});
