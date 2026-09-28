/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: ".",
  testEnvironment: "node",
  testRegex: ".e2e-spec\\.ts$",
  transform: {
    "^.+\\.ts$": "ts-jest",
  },
  // WHERE THESE SUITES ARE ALLOWED TO WRITE — `platform_test`, and
  // nothing else. The guard runs before the test module imports
  // `@prisma/client`, so it wins over the `.env` the dev server reads,
  // and it REFUSES rather than merely redirecting.
  setupFiles: ["<rootDir>/setup-test-database.ts"],
  // These tests share one real Postgres/Redis backend across files
  // (registration, policies, rate-limit counters, admin identities) —
  // running files in parallel workers causes cross-file interference
  // (e.g. a policy published by one file becoming globally mandatory
  // for another file's registration mid-run). Always serial.
  maxWorkers: 1,

  // These tests drive a real HTTP server against a real Postgres and
  // Redis, and a single case can register a company, publish an offer,
  // buy it and settle it. Jest's default 5 s is a unit-test budget:
  // cases that took longer failed with «Exceeded timeout of 5000 ms»,
  // which reads like a hang and is really an under-declared one. A
  // ceiling, not a delay.
  testTimeout: 60_000,
};
