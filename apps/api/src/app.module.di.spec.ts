import { Test } from "@nestjs/testing";
import { AppModule } from "./app.module";

/**
 * Compiles the REAL application graph, exactly as `main.ts` does.
 *
 * Why this exists
 * ---------------
 * Eight modules injected a provider whose module they never imported
 * (`NotificationEventsService` in six, `StorageService` in two). Nest
 * cannot construct such a provider, so `NestFactory.create(AppModule)`
 * threw and the API could not boot AT ALL — yet the whole unit suite
 * stayed green, because every unit test constructs its service directly
 * with a stub and nothing here ever built the graph.
 *
 * The e2e suite does import AppModule, but it needs a live Postgres and
 * Redis and runs under a separate config, so it is not what a routine
 * `pnpm test` executes. That gap is precisely what let a
 * cannot-start-the-application defect sit undetected.
 *
 * Why this is safe to run in the unit suite
 * -----------------------------------------
 * `.compile()` builds the dependency graph and instantiates providers,
 * but does NOT run lifecycle hooks. Every outbound connection in this
 * application is opened in `onModuleInit` — PrismaService.$connect,
 * RedisService's `new Redis(..., { lazyConnect: true })` + connect, and
 * StorageService's HeadBucket probe. So this touches no network, needs
 * no container, and finishes in milliseconds.
 *
 * Nest reports only the FIRST missing import per boot, so a failure here
 * names one module at a time. `scripts/di-audit` style static analysis
 * finds them all in one pass; this test is the guarantee that none ever
 * reaches a commit.
 */

/**
 * The minimum `loadEnv()` accepts. Every value is obviously synthetic —
 * the two encryption keys are literal runs of one character, built at
 * runtime so no 64-char hex constant is ever written into the source.
 */
const FAKE_ENV: Record<string, string> = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://unused:unused@127.0.0.1:1/unused",
  REDIS_URL: "redis://127.0.0.1:1",
  ADMIN_TOTP_ENCRYPTION_KEY: "a".repeat(64),
  ADMIN_TOTP_ISSUER: "Azier Plus Admin",
  BANK_DATA_ENCRYPTION_KEY: "b".repeat(64),
  STORAGE_ENDPOINT: "http://127.0.0.1:1",
  STORAGE_REGION: "us-east-1",
  STORAGE_ACCESS_KEY: "unused-access-key",
  STORAGE_SECRET_KEY: "unused-secret-key",
  STORAGE_BUCKET_NAME: "unused-bucket",
};

describe("AppModule dependency graph", () => {
  const originalEnv = process.env;

  beforeAll(() => {
    process.env = { ...originalEnv, ...FAKE_ENV };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("compiles — every injected provider is exported by an imported module", async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    // Nothing was initialised, so nothing needs closing beyond releasing
    // the graph itself.
    await moduleRef.close();
  });
});
