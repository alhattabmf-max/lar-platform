import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const SCRIPT = join(__dirname, "..", "clean-build-artifacts.mjs");

// Windows refuses `dir` symlinks without elevation, but allows
// junctions, which lstat() still reports as symbolic links.
const DIR_LINK_TYPE = process.platform === "win32" ? "junction" : "dir";

test("removes dist/ and *.tsbuildinfo inside a valid workspace package dir", () => {
  const root = mkdtempSync(join(tmpdir(), "clean-test-"));
  try {
    writeFileSync(join(root, "pnpm-workspace.yaml"), 'packages:\n  - "packages/*"\n');
    const pkgDir = join(root, "packages", "fake-pkg");
    mkdirSync(join(pkgDir, "dist"), { recursive: true });
    writeFileSync(join(pkgDir, "dist", "index.js"), "x");
    writeFileSync(join(pkgDir, "tsconfig.tsbuildinfo"), "{}");

    execFileSync("node", [SCRIPT], { cwd: pkgDir });

    assert.equal(existsSync(join(pkgDir, "dist")), false);
    assert.equal(existsSync(join(pkgDir, "tsconfig.tsbuildinfo")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("refuses to run outside a known pnpm workspace — nothing is deleted, non-zero exit", () => {
  const outside = mkdtempSync(join(tmpdir(), "clean-test-outside-"));
  try {
    mkdirSync(join(outside, "dist"));
    writeFileSync(join(outside, "dist", "x.js"), "x");

    assert.throws(() => {
      execFileSync("node", [SCRIPT], { cwd: outside, stdio: "pipe" });
    });
    assert.equal(existsSync(join(outside, "dist")), true, "dist must survive when the script refuses to run");
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});

test("refuses to run directly at the workspace root (must be a package subdirectory)", () => {
  const root = mkdtempSync(join(tmpdir(), "clean-test-root-"));
  try {
    writeFileSync(join(root, "pnpm-workspace.yaml"), 'packages:\n  - "packages/*"\n');
    mkdirSync(join(root, "dist"));
    writeFileSync(join(root, "dist", "x.js"), "x");

    assert.throws(() => {
      execFileSync("node", [SCRIPT], { cwd: root, stdio: "pipe" });
    });
    assert.equal(existsSync(join(root, "dist")), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a dist/ symlink to an external directory is unlinked, never followed or deleted-through", () => {
  const root = mkdtempSync(join(tmpdir(), "clean-test-symlink-"));
  const external = mkdtempSync(join(tmpdir(), "clean-test-external-"));
  try {
    writeFileSync(join(root, "pnpm-workspace.yaml"), 'packages:\n  - "packages/*"\n');
    const pkgDir = join(root, "packages", "fake-pkg");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(external, "important.txt"), "do not delete me");
    symlinkSync(external, join(pkgDir, "dist"), DIR_LINK_TYPE);

    execFileSync("node", [SCRIPT], { cwd: pkgDir });

    assert.equal(existsSync(join(pkgDir, "dist")), false, "the symlink itself must be removed");
    assert.equal(existsSync(join(external, "important.txt")), true, "the external target must be untouched");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(external, { recursive: true, force: true });
  }
});

test("is a no-op (exit 0) when there is nothing to clean", () => {
  const root = mkdtempSync(join(tmpdir(), "clean-test-noop-"));
  try {
    writeFileSync(join(root, "pnpm-workspace.yaml"), 'packages:\n  - "packages/*"\n');
    const pkgDir = join(root, "packages", "fake-pkg");
    mkdirSync(pkgDir, { recursive: true });

    execFileSync("node", [SCRIPT], { cwd: pkgDir });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
