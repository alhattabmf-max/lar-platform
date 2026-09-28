/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: "src",
  testRegex: ".*\\.spec\\.ts$",
  transform: {
    "^.+\\.ts$": "ts-jest",
  },
  collectCoverageFrom: ["**/*.(t|j)s"],
  coverageDirectory: "../coverage",
  testEnvironment: "node",
  // EVERY SUITE POINTS AT `platform_test`, this one included — see
  // `test/setup-test-database.ts`. Unit specs are not supposed to open a
  // connection at all, and wiring the guard here is what makes that true
  // rather than assumed: one that starts touching the database reaches
  // the test database, never the developer's own.
  setupFiles: ["<rootDir>/../test/setup-test-database.ts"],
};
