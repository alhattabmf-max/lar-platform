import "reflect-metadata";
import type { Env } from "@platform/config";
import { StorageService } from "../src/storage/storage.service";

/**
 * This test talks to a REAL, live MinIO instance — it is intentionally
 * not mocked (unlike storage.service.spec.ts, which is a unit test
 * with a mocked S3 client). It requires MinIO to actually be running
 * and reachable, exactly as `docker-compose.yml` provisions it. Run
 * via `pnpm --filter api run test:integration`, not as part of the
 * fast unit test suite.
 */
function integrationEnv(): Env {
  return {
    NODE_ENV: "test",
    PORT: 3000,
    LOG_LEVEL: "info",
    TZ: "UTC",
    DEFAULT_DISPLAY_TIMEZONE: "Asia/Riyadh",
    DATABASE_URL: "postgresql://platform:platform@localhost:5432/platform_test",
    REDIS_URL: "redis://localhost:6379",
    ADMIN_TOTP_ENCRYPTION_KEY: "a".repeat(64),
    BANK_DATA_ENCRYPTION_KEY: "b".repeat(64),
    STORAGE_ENDPOINT: process.env.STORAGE_ENDPOINT ?? "http://localhost:9000",
    STORAGE_REGION: process.env.STORAGE_REGION ?? "us-east-1",
    STORAGE_ACCESS_KEY: process.env.STORAGE_ACCESS_KEY ?? "platform_minio_access",
    STORAGE_SECRET_KEY: process.env.STORAGE_SECRET_KEY ?? "platform_minio_secret",
    STORAGE_BUCKET_NAME: process.env.STORAGE_BUCKET_NAME ?? "platform-test",
    STORAGE_FORCE_PATH_STYLE: true,
    EMAIL_PROVIDER_MODE: "mock",
    EMAIL_REQUIRED: false,
    MAP_PROVIDER_MODE: "manual",
    CORS_ALLOWED_ORIGINS: [],
  };
}

describe("StorageService (live MinIO integration)", () => {
  let service: StorageService;
  const key = `phase1-verification/integration-test-${Date.now()}.txt`;
  const content = `Phase 1 Foundation — MinIO integration test — ${new Date().toISOString()}`;

  beforeAll(async () => {
    service = new StorageService(integrationEnv());
    // Mirrors what happens automatically in the real app's
    // OnModuleInit — ensures the bucket exists before we use it.
    await service.onModuleInit();
  });

  afterAll(async () => {
    // Best-effort cleanup in case an assertion fails before the
    // explicit delete step runs.
    await service.delete(key).catch(() => undefined);
  });

  it("uploads an object to MinIO", async () => {
    await expect(
      service.upload(key, Buffer.from(content, "utf-8"), "text/plain")
    ).resolves.toBeUndefined();
  });

  it("reads back the exact same content that was uploaded", async () => {
    const result = await service.read(key);
    expect(result.toString("utf-8")).toBe(content);
  });

  it("deletes the object, and a subsequent read fails", async () => {
    await expect(service.delete(key)).resolves.toBeUndefined();
    await expect(service.read(key)).rejects.toThrow();
  });

  it("reports ok:true from ping() while MinIO and the bucket are reachable", async () => {
    const result = await service.ping();
    expect(result).toEqual({ ok: true });
  });
});
