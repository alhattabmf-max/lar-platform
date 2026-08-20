/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: ".",
  testEnvironment: "node",
  testRegex: ".e2e-spec\\.ts$",
  transform: {
    "^.+\\.ts$": "ts-jest",
  },
  // These tests share one real Postgres/Redis backend across files
  // (registration, policies, rate-limit counters, admin identities) —
  // running files in parallel workers causes cross-file interference
  // (e.g. a policy published by one file becoming globally mandatory
  // for another file's registration mid-run). Always serial.
  maxWorkers: 1,
};
