#!/usr/bin/env node
// Cross-platform (Windows/Linux/macOS) replacement for the root
// `clean` script, which previously shelled out to `find | xargs rm`
// and therefore failed on Windows with:
//
//   'xargs' is not recognized as an internal or external command
//
// Uses Node's fs APIs only — no Bash, no find, no xargs, no rm, no
// shell of any kind.
//
// Scope — it removes exactly two things, and nothing else:
//   1. <root>/{apps,packages}/<pkg>/dist
//   2. *.tsbuildinfo files under <root>/{apps,packages}/<pkg>/,
//      pruning node_modules/, dist/ and .git/
//
// Safety model:
//   1. Refuses to run unless the resolved root actually contains
//      pnpm-workspace.yaml. Every deletion is then bounded to inside
//      that root by assertInsideRoot(), which rejects both `..`
//      escapes and (on Windows) cross-drive paths.
//   2. Package directories are discovered with readdirSync(), so no
//      caller-supplied path is ever interpolated into a delete.
//   3. Symlinks are never followed. A symlinked package directory is
//      skipped entirely; a symlinked dist/ has only the link itself
//      unlinked, so whatever it points at is left untouched.
//   4. node_modules is never descended into and never deleted, and
//      only paths named exactly `dist` or ending in `.tsbuildinfo`
//      are ever removed — source files cannot be reached.

import { existsSync, lstatSync, readdirSync, realpathSync, rmSync, unlinkSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const WORKSPACE_GROUPS = ["apps", "packages"];
const DIST_DIR = "dist";
const TSBUILDINFO_SUFFIX = ".tsbuildinfo";
const NEVER_DESCEND = new Set(["node_modules", DIST_DIR, ".git"]);
const MAX_SCAN_DEPTH = 12;

/**
 * Walk up from `startDir` looking for the pnpm workspace root.
 * Returns null when there is none — the caller must then refuse.
 */
export function findWorkspaceRoot(startDir) {
  let dir = resolve(startDir);
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

/**
 * Throws unless `candidate` is strictly inside `root`.
 * `relative()` returns an absolute path when the two are on
 * different Windows drives, which `isAbsolute` catches.
 */
export function assertInsideRoot(root, candidate) {
  const rel = relative(root, candidate);
  const escapes = rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || rel.startsWith("../");
  if (escapes || isAbsolute(rel)) {
    throw new Error(`clean-workspace-artifacts: refusing — ${candidate} escapes workspace root ${root}.`);
  }
  return candidate;
}

function removeDist(root, pkgDir, removed, dryRun) {
  const distPath = assertInsideRoot(root, join(pkgDir, DIST_DIR));

  let st;
  try {
    st = lstatSync(distPath);
  } catch {
    return; // does not exist — nothing to do
  }

  if (st.isSymbolicLink()) {
    // Unlink the link only. Its target is never opened, traversed or
    // deleted, so a dist/ pointing outside the repo is harmless.
    if (!dryRun) unlinkSync(distPath);
    removed.push({ path: distPath, kind: "dist-symlink" });
    return;
  }

  // A plain *file* named dist is not a build-output directory; leave
  // it alone, matching the `find -type d` semantics this replaces.
  if (!st.isDirectory()) return;

  if (!dryRun) rmSync(distPath, { recursive: true, force: true });
  removed.push({ path: distPath, kind: "dist" });
}

function removeTsBuildInfo(root, dir, removed, dryRun, depth = 0) {
  if (depth > MAX_SCAN_DEPTH) return;

  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    // Dirent uses lstat semantics, so a symlink reports
    // isSymbolicLink() === true and isDirectory() === false.
    if (entry.isSymbolicLink()) continue;

    const entryPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (NEVER_DESCEND.has(entry.name)) continue;
      removeTsBuildInfo(root, entryPath, removed, dryRun, depth + 1);
      continue;
    }

    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(TSBUILDINFO_SUFFIX)) continue;

    assertInsideRoot(root, entryPath);
    if (!dryRun) unlinkSync(entryPath);
    removed.push({ path: entryPath, kind: "tsbuildinfo" });
  }
}

export function cleanWorkspaceArtifacts(rootInput, { dryRun = false } = {}) {
  const resolvedRoot = resolve(rootInput);

  if (!existsSync(join(resolvedRoot, "pnpm-workspace.yaml"))) {
    throw new Error(
      `clean-workspace-artifacts: refusing to run — ${resolvedRoot} is not a pnpm workspace root (no pnpm-workspace.yaml).`
    );
  }

  // Normalise through realpath so the containment check compares
  // like with like (Windows short paths, /tmp -> /private/tmp, ...).
  const root = realpathSync(resolvedRoot);
  const removed = [];

  for (const group of WORKSPACE_GROUPS) {
    const groupDir = assertInsideRoot(root, join(root, group));

    let entries;
    try {
      entries = readdirSync(groupDir, { withFileTypes: true });
    } catch {
      continue; // group directory absent — fine
    }

    for (const entry of entries) {
      // Skips symlinked package directories outright: isDirectory()
      // is false for a symlink under withFileTypes.
      if (!entry.isDirectory()) continue;
      if (entry.name === "node_modules") continue;

      const pkgDir = assertInsideRoot(root, join(groupDir, entry.name));
      removeDist(root, pkgDir, removed, dryRun);
      removeTsBuildInfo(root, pkgDir, removed, dryRun);
    }
  }

  return removed;
}

const invokedDirectly =
  process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;

if (invokedDirectly) {
  const dryRun = process.argv.includes("--dry-run");
  try {
    const root = findWorkspaceRoot(process.cwd());
    if (!root) {
      throw new Error(
        `clean-workspace-artifacts: refusing to run — no pnpm-workspace.yaml found at or above ${process.cwd()}.`
      );
    }

    const removed = cleanWorkspaceArtifacts(root, { dryRun });
    const prefix = dryRun ? "clean-workspace-artifacts [dry-run]" : "clean-workspace-artifacts";

    if (removed.length === 0) {
      console.log(`${prefix}: nothing to clean.`);
    } else {
      const lines = removed.map((r) => `  ${r.kind.padEnd(13)} ${relative(root, r.path)}`);
      console.log(`${prefix}: removed ${removed.length} item(s):\n${lines.join("\n")}`);
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
