import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const SCRIPT = join(__dirname, "..", "verify-build-output.mjs");

test("exits 0 when the expected file exists", () => {
  const dir = mkdtempSync(join(tmpdir(), "verify-test-"));
  try {
    mkdirSync(join(dir, "dist"));
    writeFileSync(join(dir, "dist", "main.js"), "x");
    execFileSync("node", [SCRIPT, "dist/main.js"], { cwd: dir });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("exits non-zero with a clear message when the expected file is missing", () => {
  const dir = mkdtempSync(join(tmpdir(), "verify-test-missing-"));
  try {
    assert.throws(() => {
      execFileSync("node", [SCRIPT, "dist/main.js"], { cwd: dir, stdio: "pipe" });
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("refuses a path that traverses outside the current directory", () => {
  const dir = mkdtempSync(join(tmpdir(), "verify-test-traversal-"));
  try {
    assert.throws(() => {
      execFileSync("node", [SCRIPT, "../../../etc/passwd"], { cwd: dir, stdio: "pipe" });
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("exits non-zero when no argument is given", () => {
  const dir = mkdtempSync(join(tmpdir(), "verify-test-noarg-"));
  try {
    assert.throws(() => {
      execFileSync("node", [SCRIPT], { cwd: dir, stdio: "pipe" });
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
