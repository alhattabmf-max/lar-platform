#!/usr/bin/env node
// Cross-platform (Linux/macOS/Windows) replacement for `rm -rf dist
// *.tsbuildinfo`. Works via Node's fs APIs only — no Bash, no WSL
// required.
//
// Safety model:
//   1. Refuses to run at all unless the current directory is
//      confirmed to be a subdirectory of a real pnpm workspace
//      (found by walking up for pnpm-workspace.yaml). This bounds
//      every deletion to inside the monorepo, never anywhere else
//      on disk.
//   2. Only ever deletes <cwd>/dist and top-level *.tsbuildinfo
//      files in <cwd> — never recurses into node_modules, never
//      accepts a path argument, never walks below dist/.
//   3. If dist/ is a symlink, the symlink itself is removed and its
//      target is never touched or traversed — this is what stops a
//      maliciously (or accidentally) redirected dist/ from deleting
//      something outside the package.
//
// This exists because a stale tsconfig.build.tsbuildinfo cache was
// found (2026-08-19) to silently corrupt `nest build`, producing
// only .d.ts with zero .js output — with no error message. Running
// this before every build closes that failure mode permanently.

import { existsSync, lstatSync, readdirSync, rmSync, unlinkSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

function findWorkspaceRoot(startDir) {
  let dir = resolve(startDir);
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

export function cleanBuildArtifacts(targetDirInput) {
  const targetDir = resolve(targetDirInput);
  const root = findWorkspaceRoot(targetDir);

  if (!root) {
    throw new Error(
      `clean-build-artifacts: refusing to run — no pnpm-workspace.yaml found above ${targetDir}. This script only operates inside a known monorepo.`
    );
  }

  const rel = relative(root, targetDir);
  if (rel === "" || rel.startsWith("..")) {
    throw new Error(
      `clean-build-artifacts: refusing to run — ${targetDir} is not a package subdirectory of workspace root ${root}.`
    );
  }

  const removed = [];

  const distPath = join(targetDir, "dist");
  if (existsSync(distPath) || isDanglingSymlink(distPath)) {
    if (relative(targetDir, distPath) !== "dist") {
      throw new Error("clean-build-artifacts: refusing — computed dist path escapes the target directory.");
    }
    const st = lstatSync(distPath);
    if (st.isSymbolicLink()) {
      // Never follow the symlink — remove only the link itself,
      // whatever it points to is left completely untouched.
      unlinkSync(distPath);
    } else if (st.isDirectory()) {
      rmSync(distPath, { recursive: true, force: true });
    } else {
      unlinkSync(distPath);
    }
    removed.push(distPath);
  }

  for (const entry of readdirSync(targetDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".tsbuildinfo")) {
      const filePath = join(targetDir, entry.name);
      unlinkSync(filePath);
      removed.push(filePath);
    }
  }

  return removed;
}

function isDanglingSymlink(p) {
  try {
    const st = lstatSync(p);
    return st.isSymbolicLink();
  } catch {
    return false;
  }
}

// Only run as a CLI when invoked directly (not when imported by tests).
// pathToFileURL is required for correctness on Windows, where
// `file://${process.argv[1]}` yields "file://C:\path\to.mjs" but
// import.meta.url is "file:///C:/path/to.mjs" — they never match, so
// the naive comparison silently disabled this script on Windows.
if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const removed = cleanBuildArtifacts(process.cwd());
    if (removed.length === 0) {
      console.log("clean-build-artifacts: nothing to clean.");
    } else {
      console.log(`clean-build-artifacts: removed ${removed.length} item(s):\n  ${removed.join("\n  ")}`);
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
