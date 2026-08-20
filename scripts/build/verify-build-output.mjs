#!/usr/bin/env node
// Cross-platform (Linux/macOS/Windows) replacement for `test -f
// <file>` used as a build postcheck. Fails loudly (non-zero exit)
// if the expected build output is missing — this is the exact
// guard that would have caught, immediately and clearly, the
// 2026-08-19 incident where a stale .tsbuildinfo cache silently
// produced zero .js output from `nest build`.

import { existsSync } from "node:fs";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function verifyBuildOutput(cwdInput, relativeArg) {
  const cwd = resolve(cwdInput);
  const target = resolve(cwd, relativeArg);

  // Path traversal guard: the expected file must resolve to
  // somewhere inside the current package directory, never above it.
  const rel = relative(cwd, target);
  if (rel.startsWith("..")) {
    throw new Error(`verify-build-output: refusing — "${relativeArg}" resolves outside ${cwd}.`);
  }

  if (!existsSync(target)) {
    throw new Error(`BUILD FAILED: expected build output not found: ${target}`);
  }

  return target;
}

// pathToFileURL is required for correctness on Windows — see the note
// in clean-build-artifacts.mjs.
if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const arg = process.argv[2];
  if (!arg) {
    console.error("verify-build-output: usage: node verify-build-output.mjs <relative-path-to-expected-file>");
    process.exit(1);
  }
  try {
    const target = verifyBuildOutput(process.cwd(), arg);
    console.log(`verify-build-output: OK — ${target} exists.`);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
