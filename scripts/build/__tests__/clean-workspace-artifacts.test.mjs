import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { assertInsideRoot, cleanWorkspaceArtifacts } from "../clean-workspace-artifacts.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const SCRIPT = join(__dirname, "..", "clean-workspace-artifacts.mjs");

// Windows refuses `dir` symlinks without elevation, but allows
// junctions, which lstat() still reports as symbolic links.
const DIR_LINK_TYPE = process.platform === "win32" ? "junction" : "dir";

function makeWorkspace() {
  const root = mkdtempSync(join(tmpdir(), "clean-ws-"));
  writeFileSync(join(root, "pnpm-workspace.yaml"), 'packages:\n  - "apps/*"\n  - "packages/*"\n');
  return root;
}

function makePackage(root, group, name) {
  const dir = join(root, group, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function write(path, contents = "x") {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, contents);
}

function cleanup(...dirs) {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

test("removes dist/ and *.tsbuildinfo across every apps/* and packages/* package", () => {
  const root = makeWorkspace();
  try {
    const api = makePackage(root, "apps", "api");
    const types = makePackage(root, "packages", "types");

    mkdirSync(join(api, "dist", "nested"), { recursive: true });
    write(join(api, "dist", "main.js"));
    write(join(api, "dist", "nested", "deep.js"));
    write(join(api, "tsconfig.build.tsbuildinfo"), "{}");

    mkdirSync(join(types, "dist"), { recursive: true });
    write(join(types, "dist", "index.js"));
    write(join(types, "tsconfig.tsbuildinfo"), "{}");

    const removed = cleanWorkspaceArtifacts(root);

    assert.equal(existsSync(join(api, "dist")), false);
    assert.equal(existsSync(join(api, "tsconfig.build.tsbuildinfo")), false);
    assert.equal(existsSync(join(types, "dist")), false);
    assert.equal(existsSync(join(types, "tsconfig.tsbuildinfo")), false);
    assert.equal(removed.length, 4);
  } finally {
    cleanup(root);
  }
});

test("removes a *.tsbuildinfo nested below the package root", () => {
  const root = makeWorkspace();
  try {
    const pkg = makePackage(root, "packages", "domain");
    mkdirSync(join(pkg, "src", "sub"), { recursive: true });
    write(join(pkg, "src", "sub", "tsconfig.tsbuildinfo"), "{}");
    write(join(pkg, "src", "sub", "index.ts"), "export const a = 1;");

    cleanWorkspaceArtifacts(root);

    assert.equal(existsSync(join(pkg, "src", "sub", "tsconfig.tsbuildinfo")), false);
    assert.equal(existsSync(join(pkg, "src", "sub", "index.ts")), true);
  } finally {
    cleanup(root);
  }
});

test("never deletes node_modules, source files, or anything at the workspace root", () => {
  const root = makeWorkspace();
  try {
    const api = makePackage(root, "apps", "api");

    mkdirSync(join(api, "node_modules", "left-pad"), { recursive: true });
    write(join(api, "node_modules", "left-pad", "index.js"));
    // A .tsbuildinfo *inside* node_modules must be pruned, not deleted.
    write(join(api, "node_modules", "left-pad", "tsconfig.tsbuildinfo"), "{}");
    // A dist/ inside node_modules belongs to a dependency — leave it.
    mkdirSync(join(api, "node_modules", "left-pad", "dist"), { recursive: true });
    write(join(api, "node_modules", "left-pad", "dist", "dep.js"));

    mkdirSync(join(api, "src"), { recursive: true });
    write(join(api, "src", "main.ts"), "export const main = 1;");
    write(join(api, "package.json"), "{}");
    write(join(api, "tsconfig.json"), "{}");

    write(join(root, "package.json"), "{}");
    write(join(root, "pnpm-lock.yaml"), "lock");
    mkdirSync(join(root, "node_modules"), { recursive: true });
    write(join(root, "node_modules", "marker.js"));

    const removed = cleanWorkspaceArtifacts(root);

    assert.deepEqual(removed, [], "nothing in this fixture is a build artifact");
    assert.equal(existsSync(join(api, "node_modules", "left-pad", "index.js")), true);
    assert.equal(existsSync(join(api, "node_modules", "left-pad", "tsconfig.tsbuildinfo")), true);
    assert.equal(existsSync(join(api, "node_modules", "left-pad", "dist", "dep.js")), true);
    assert.equal(existsSync(join(api, "src", "main.ts")), true);
    assert.equal(existsSync(join(api, "package.json")), true);
    assert.equal(existsSync(join(api, "tsconfig.json")), true);
    assert.equal(existsSync(join(root, "package.json")), true);
    assert.equal(existsSync(join(root, "pnpm-lock.yaml")), true);
    assert.equal(existsSync(join(root, "node_modules", "marker.js")), true);
  } finally {
    cleanup(root);
  }
});

test("a dist/ at the workspace root is not touched — only apps/* and packages/* are in scope", () => {
  const root = makeWorkspace();
  try {
    mkdirSync(join(root, "dist"), { recursive: true });
    write(join(root, "dist", "root-artifact.js"));
    write(join(root, "tsconfig.tsbuildinfo"), "{}");

    const removed = cleanWorkspaceArtifacts(root);

    assert.deepEqual(removed, []);
    assert.equal(existsSync(join(root, "dist", "root-artifact.js")), true);
    assert.equal(existsSync(join(root, "tsconfig.tsbuildinfo")), true);
  } finally {
    cleanup(root);
  }
});

// --- path traversal -------------------------------------------------

test("assertInsideRoot rejects ../ escapes and same-name sibling prefixes", () => {
  const root = join(tmpdir(), "ws-root");

  assert.throws(() => assertInsideRoot(root, join(root, "..", "etc")), /escapes workspace root/);
  assert.throws(() => assertInsideRoot(root, join(root, "apps", "..", "..", "outside")), /escapes workspace root/);
  assert.throws(() => assertInsideRoot(root, root), /escapes workspace root/);
  // "ws-root-evil" must not be accepted just because it shares a prefix.
  assert.throws(() => assertInsideRoot(root, join(tmpdir(), "ws-root-evil", "dist")), /escapes workspace root/);

  assert.doesNotThrow(() => assertInsideRoot(root, join(root, "apps", "api", "dist")));
});

test("refuses to run when the target directory is not a pnpm workspace root", () => {
  const outside = mkdtempSync(join(tmpdir(), "clean-ws-outside-"));
  try {
    mkdirSync(join(outside, "apps", "api", "dist"), { recursive: true });
    write(join(outside, "apps", "api", "dist", "keep.js"));

    assert.throws(() => cleanWorkspaceArtifacts(outside), /not a pnpm workspace root/);
    assert.equal(existsSync(join(outside, "apps", "api", "dist", "keep.js")), true);
  } finally {
    cleanup(outside);
  }
});

test("CLI exits non-zero and deletes nothing when run outside any workspace", () => {
  const outside = mkdtempSync(join(tmpdir(), "clean-ws-cli-outside-"));
  try {
    mkdirSync(join(outside, "apps", "api", "dist"), { recursive: true });
    write(join(outside, "apps", "api", "dist", "keep.js"));

    assert.throws(() => execFileSync(process.execPath, [SCRIPT], { cwd: outside, stdio: "pipe" }));
    assert.equal(existsSync(join(outside, "apps", "api", "dist", "keep.js")), true);
  } finally {
    cleanup(outside);
  }
});

// --- symlinks -------------------------------------------------------

test("an external dist/ symlink is unlinked while its target stays intact", () => {
  const root = makeWorkspace();
  const external = mkdtempSync(join(tmpdir(), "clean-ws-external-"));
  try {
    const pkg = makePackage(root, "packages", "types");
    write(join(external, "important.txt"), "do not delete me");
    symlinkSync(external, join(pkg, "dist"), DIR_LINK_TYPE);

    const removed = cleanWorkspaceArtifacts(root);

    assert.equal(existsSync(join(pkg, "dist")), false, "the link itself must be removed");
    assert.equal(existsSync(join(external, "important.txt")), true, "the target must be untouched");
    assert.equal(readFileSync(join(external, "important.txt"), "utf8"), "do not delete me");
    assert.deepEqual(
      removed.map((r) => r.kind),
      ["dist-symlink"]
    );
  } finally {
    cleanup(root, external);
  }
});

test("a symlinked package directory pointing outside the root is skipped entirely", () => {
  const root = makeWorkspace();
  const external = mkdtempSync(join(tmpdir(), "clean-ws-extpkg-"));
  try {
    mkdirSync(join(root, "packages"), { recursive: true });
    mkdirSync(join(external, "dist"), { recursive: true });
    write(join(external, "dist", "external.js"));
    write(join(external, "tsconfig.tsbuildinfo"), "{}");
    symlinkSync(external, join(root, "packages", "evil"), DIR_LINK_TYPE);

    const removed = cleanWorkspaceArtifacts(root);

    assert.deepEqual(removed, [], "a symlinked package dir must not be traversed");
    assert.equal(existsSync(join(external, "dist", "external.js")), true);
    assert.equal(existsSync(join(external, "tsconfig.tsbuildinfo")), true);
    assert.equal(existsSync(join(root, "packages", "evil")), true, "the link itself is left alone too");
  } finally {
    cleanup(root, external);
  }
});

test("a symlinked directory inside a package is not followed during the tsbuildinfo scan", () => {
  const root = makeWorkspace();
  const external = mkdtempSync(join(tmpdir(), "clean-ws-extsrc-"));
  try {
    const pkg = makePackage(root, "apps", "api");
    write(join(external, "tsconfig.tsbuildinfo"), "{}");
    mkdirSync(join(pkg, "src"), { recursive: true });
    symlinkSync(external, join(pkg, "src", "linked"), DIR_LINK_TYPE);

    const removed = cleanWorkspaceArtifacts(root);

    assert.deepEqual(removed, []);
    assert.equal(existsSync(join(external, "tsconfig.tsbuildinfo")), true);
  } finally {
    cleanup(root, external);
  }
});

// --- CLI ------------------------------------------------------------

test("--dry-run reports what it would remove without removing it", () => {
  const root = makeWorkspace();
  try {
    const pkg = makePackage(root, "apps", "api");
    mkdirSync(join(pkg, "dist"), { recursive: true });
    write(join(pkg, "dist", "main.js"));

    const removed = cleanWorkspaceArtifacts(root, { dryRun: true });

    assert.equal(removed.length, 1);
    assert.equal(existsSync(join(pkg, "dist", "main.js")), true);
  } finally {
    cleanup(root);
  }
});

test("CLI runs from the workspace root and is a no-op (exit 0) when there is nothing to clean", () => {
  const root = makeWorkspace();
  try {
    makePackage(root, "apps", "api");
    const out = execFileSync(process.execPath, [SCRIPT], { cwd: root, encoding: "utf8" });
    assert.match(out, /nothing to clean/);
  } finally {
    cleanup(root);
  }
});

test("CLI can be invoked from a package subdirectory and still cleans the whole workspace", () => {
  const root = makeWorkspace();
  try {
    const api = makePackage(root, "apps", "api");
    const types = makePackage(root, "packages", "types");
    mkdirSync(join(api, "dist"), { recursive: true });
    write(join(api, "dist", "main.js"));
    mkdirSync(join(types, "dist"), { recursive: true });
    write(join(types, "dist", "index.js"));

    execFileSync(process.execPath, [SCRIPT], { cwd: api, encoding: "utf8" });

    assert.equal(existsSync(join(api, "dist")), false);
    assert.equal(existsSync(join(types, "dist")), false);
  } finally {
    cleanup(root);
  }
});
