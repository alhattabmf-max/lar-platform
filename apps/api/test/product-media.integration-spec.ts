import "reflect-metadata";
import { randomUUID } from "crypto";
import sharp from "sharp";
import { PrismaClient } from "@prisma/client";
import { S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";
import { StorageService } from "../src/storage/storage.service";
import { MediaPolicyService } from "../src/settings/media-policy.service";
import { ProductsService } from "../src/products/products.service";
import { ProductMediaService } from "../src/products/product-media.service";
import { AuditService } from "../src/audit/audit.service";
import type { PrismaService } from "../src/database/prisma.service";
import type { Env } from "@platform/config";

const prisma = new PrismaClient() as unknown as PrismaService;

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
    ADMIN_TOTP_ISSUER: "Azier Plus Admin",
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

async function makeTestJpeg(width = 400, height = 300): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 10, g: 20, b: 30 } } })
    .jpeg()
    .toBuffer();
}

async function objectExists(s3: S3Client, bucket: string, key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

describe("ProductMediaService (live MinIO + Postgres integration)", () => {
  const env = integrationEnv();
  let storage: StorageService;
  let mediaPolicy: MediaPolicyService;
  let products: ProductsService;
  let media: ProductMediaService;
  let s3: S3Client;
  let companyId: string;
  let productId: string;

  beforeAll(async () => {
    storage = new StorageService(env);
    await storage.onModuleInit();
    const audit = new AuditService(prisma);
    mediaPolicy = new MediaPolicyService(
      prisma,
      { getJsonSafe: async (_k: string, _v: unknown, fallback: unknown) => fallback } as never,
      audit
    );
    products = new ProductsService(prisma, audit);
    media = new ProductMediaService(prisma, audit, storage, mediaPolicy, products);

    s3 = new S3Client({
      endpoint: env.STORAGE_ENDPOINT,
      region: env.STORAGE_REGION,
      forcePathStyle: true,
      credentials: { accessKeyId: env.STORAGE_ACCESS_KEY, secretAccessKey: env.STORAGE_SECRET_KEY },
    });

    const company = await prisma.company.create({
      data: {
        crNumber: `CR-MEDIA-IT-${Date.now()}`,
        legalName: "Media IT Co",
        accountType: "SUPPLIER",
        verificationStatus: "VERIFIED",
      },
    });
    companyId = company.id;

    const node = await prisma.taxonomyNode.create({ data: { nameAr: "a", nameEn: "a" } });
    const unit = await prisma.salesUnit.create({ data: { nameAr: "u", nameEn: "u" } });

    const product = await prisma.product.create({
      data: {
        companyId,
        taxonomyNodeId: node.id,
        salesUnitId: unit.id,
        salesUnitNameAr: "u",
        salesUnitNameEn: "u",
        nameAr: "منتج",
        nameEn: "Product",
        weightPerUnit: 1,
        lengthCm: 1,
        widthCm: 1,
        heightCm: 1,
      },
    });
    productId = product.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("uploads a real image end-to-end: processes, stores main+thumbnail in MinIO, creates DB row", async () => {
    const buffer = await makeTestJpeg();
    const result = await media.upload(productId, buffer, {
      userId: randomUUID(),
      companyId,
      requestId: "req-1",
    });

    expect(result.isMain).toBe(true);
    expect(await objectExists(s3, env.STORAGE_BUCKET_NAME, result.objectKey)).toBe(true);
    expect(await objectExists(s3, env.STORAGE_BUCKET_NAME, result.thumbnailObjectKey)).toBe(true);
  });

  it("deletes DB row first, then removes both objects from Storage", async () => {
    const buffer = await makeTestJpeg();
    const uploaded = await media.upload(productId, buffer, {
      userId: randomUUID(),
      companyId,
      requestId: "req-2",
    });

    await media.remove(productId, uploaded.id, { userId: randomUUID(), companyId, requestId: "req-3" });

    const row = await prisma.productMedia.findUnique({ where: { id: uploaded.id } });
    expect(row).toBeNull();
    expect(await objectExists(s3, env.STORAGE_BUCKET_NAME, uploaded.objectKey)).toBe(false);
    expect(await objectExists(s3, env.STORAGE_BUCKET_NAME, uploaded.thumbnailObjectKey)).toBe(false);
  });

  it("best-effort cleans up uploaded Storage objects when the DB insert fails", async () => {
    const buffer = await makeTestJpeg();

    // Force the DB step to fail by using a productId that doesn't
    // exist in the FK-referenced table — the storage upload has
    // already happened by the time this fails.
    const brokenProducts = {
      getOwnedProduct: async () => ({
        id: "00000000-0000-0000-0000-000000000000",
        archivedAt: null,
        approvalStatus: "DRAFT",
      }),
      assertEditableTx: products.assertEditableTx.bind(products),
      reapproveIfNeededTx: products.reapproveIfNeededTx.bind(products),
    } as unknown as ProductsService;

    const brokenMedia = new ProductMediaService(prisma, new AuditService(prisma), storage, mediaPolicy, brokenProducts);

    const originalUpload = storage.upload.bind(storage);
    const uploadedList: string[] = [];
    jest.spyOn(storage, "upload").mockImplementation(async (key, body, contentType) => {
      uploadedList.push(key);
      return originalUpload(key, body, contentType);
    });

    await expect(
      brokenMedia.upload("00000000-0000-0000-0000-000000000000", buffer, {
        userId: randomUUID(),
        companyId,
        requestId: "req-4",
      })
    ).rejects.toThrow();

    expect(uploadedList.length).toBe(2);
    for (const key of uploadedList) {
      expect(await objectExists(s3, env.STORAGE_BUCKET_NAME, key)).toBe(false);
    }

    (storage.upload as jest.Mock).mockRestore();
  });
});
