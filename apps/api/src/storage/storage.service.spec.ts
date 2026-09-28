import { Readable } from "stream";
import type { Env } from "@platform/config";
import { StorageService } from "./storage.service";

const send = jest.fn();

jest.mock("@aws-sdk/client-s3", () => {
  const actual = jest.requireActual("@aws-sdk/client-s3");
  return {
    ...actual,
    S3Client: jest.fn().mockImplementation(() => ({ send })),
  };
});

function testEnv(): Env {
  return {
    NODE_ENV: "test",
    PORT: 3000,
    LOG_LEVEL: "info",
    TZ: "UTC",
    DEFAULT_DISPLAY_TIMEZONE: "Asia/Riyadh",
    DATABASE_URL: "postgresql://platform:platform@localhost:5432/platform_test",
    REDIS_URL: "redis://localhost:6379",
    ADMIN_TOTP_ENCRYPTION_KEY: "a".repeat(64),
    ADMIN_TOTP_ISSUER: "Azier Plus Admin",
    BANK_DATA_ENCRYPTION_KEY: "b".repeat(64),
    STORAGE_ENDPOINT: "http://localhost:9000",
    STORAGE_REGION: "us-east-1",
    STORAGE_ACCESS_KEY: "access",
    STORAGE_SECRET_KEY: "secret",
    STORAGE_BUCKET_NAME: "platform-test",
    STORAGE_FORCE_PATH_STYLE: true,
    EMAIL_PROVIDER_MODE: "mock",
    EMAIL_REQUIRED: false,
    MAP_PROVIDER_MODE: "manual",
    CORS_ALLOWED_ORIGINS: [],
  };
}

describe("StorageService", () => {
  let service: StorageService;

  beforeEach(() => {
    send.mockReset();
    service = new StorageService(testEnv());
  });

  it("sends a PutObjectCommand with the configured bucket on upload", async () => {
    send.mockResolvedValueOnce({});
    await service.upload("phase1/test.txt", Buffer.from("hello"), "text/plain");

    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0][0];
    expect(command.input).toMatchObject({
      Bucket: "platform-test",
      Key: "phase1/test.txt",
      ContentType: "text/plain",
    });
  });

  it("reads back the full buffer from a streamed GetObjectCommand response", async () => {
    const stream = Readable.from([Buffer.from("hel"), Buffer.from("lo")]);
    send.mockResolvedValueOnce({ Body: stream });

    const result = await service.read("phase1/test.txt");
    expect(result.toString("utf-8")).toBe("hello");
  });

  it("sends a DeleteObjectCommand on delete", async () => {
    send.mockResolvedValueOnce({});
    await service.delete("phase1/test.txt");

    const command = send.mock.calls[0][0];
    expect(command.input).toMatchObject({
      Bucket: "platform-test",
      Key: "phase1/test.txt",
    });
  });

  it("returns ok:false without throwing when the health check fails", async () => {
    send.mockRejectedValueOnce(new Error("connection refused"));
    const result = await service.ping();
    expect(result).toEqual({ ok: false, error: "connection refused" });
  });

  it("returns ok:true when the health check succeeds", async () => {
    send.mockResolvedValueOnce({});
    const result = await service.ping();
    expect(result).toEqual({ ok: true });
  });
});
