/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: ".",
  testEnvironment: "node",
  testRegex: ".integration-spec\.ts$",
  transform: {
    "^.+\.ts$": "ts-jest",
  },
  // WHERE THESE SUITES ARE ALLOWED TO WRITE — `platform_test`, and
  // nothing else. The guard runs before the test module imports
  // `@prisma/client`, so it wins over the `.env` the dev server reads,
  // and it REFUSES rather than merely redirecting.
  setupFiles: ["<rootDir>/setup-test-database.ts"],
  // EVERY TEST HERE TALKS TO A REAL POSTGRES, and most of them seed a
  // whole purchase first — a supplier, a trader, an approved product, a
  // published offer, a checkout, a signed payment webhook. Jest's
  // default 5 s is a browser-unit-test budget and has nothing to do
  // with that work.
  //
  // Specs that knew this wrote `}, 30_000)` on each `it`; the ones that
  // did not failed with «Exceeded timeout of 5000 ms» — which reads
  // like a hung query and is really just an under-declared budget. It
  // belongs here once, not repeated per test, and it is a CEILING: a
  // test that finishes in 200 ms still finishes in 200 ms.
  testTimeout: 60_000,
  // TWO WORKERS, BECAUSE THEY ALL SHARE ONE POSTGRES.
  //
  // Jest's default is one worker per core, which is the right answer
  // when suites are CPU-bound and independent. These are neither: they
  // are all waiting on the SAME database, so more workers is more
  // contention on one server and not more parallelism.
  //
  // THE FAILURE THIS FIXES, and it is worth writing down because it
  // does not look like contention. Prisma's interactive transactions
  // carry a 5-second budget, set in the SERVICES, and the money path
  // uses them. Under a full-width run — with two suites now really
  // building databases and deploying a hundred and twelve migrations
  // into them — a webhook transaction that normally takes 200 ms was
  // taking over five seconds and failing with «Transaction already
  // closed». Ten tests across six suites, all on the money path, all
  // reporting a timeout that says nothing about the code under test.
  //
  // Raising that budget would have been the wrong fix: it is a
  // production setting, and it was doing its job.
  //
  // Measured: 46 suites, 332 tests, 225 s at two workers against 253 s
  // and ten failures at the default. Fewer workers is not slower here.
  maxWorkers: 2,
};
