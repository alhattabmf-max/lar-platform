import { Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { Env } from "@platform/config";
import { APP_ENV } from "../config/app-config.module";

function describeError(err: unknown): string {
  if (err instanceof Error) {
    // The AWS SDK v3 often leaves `.message` as a generic
    // "UnknownError" for certain responses (e.g. a 404 HeadBucket with
    // no body) while `.name` carries the actually useful information
    // (e.g. "NotFound"). Surface both when they differ.
    const name = "name" in err ? String((err as { name?: unknown }).name) : undefined;
    if (name && name !== "Error" && name !== err.message) {
      return `${name}: ${err.message}`;
    }
    return err.message;
  }
  return "unknown error";
}

/**
 * All file I/O in the platform goes through this service, which wraps
 * @aws-sdk/client-s3 pointed at MinIO locally. Swapping to any other
 * S3-compatible provider in production is an environment variable
 * change only — no application code changes (Blueprint §66).
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(@Inject(APP_ENV) env: Env) {
    this.bucket = env.STORAGE_BUCKET_NAME;
    this.client = new S3Client({
      endpoint: env.STORAGE_ENDPOINT,
      region: env.STORAGE_REGION,
      forcePathStyle: env.STORAGE_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: env.STORAGE_ACCESS_KEY,
        secretAccessKey: env.STORAGE_SECRET_KEY,
      },
    });
  }

  /**
   * Local/dev convenience: MinIO does not create buckets on its own.
   * Production bucket provisioning is an infrastructure/IaC concern,
   * not application code — this only fills the gap for `docker compose
   * up` / local-service development so Phase 1 works out of the box.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
        this.logger.log(`Created storage bucket "${this.bucket}"`);
      } catch (createErr) {
        this.logger.warn(
          `Could not verify or create bucket "${this.bucket}": ${describeError(createErr)}`
        );
      }
    }
  }

  async upload(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      })
    );
  }

  async read(key: string): Promise<Buffer> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key })
    );
    const stream = result.Body as NodeJS.ReadableStream;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  /**
   * Informational health check only — Object Storage is NOT a blocking
   * dependency for `/ready` in Phase 1 (per the approved plan). Its
   * status is surfaced independently in the readiness details.
   */
  async ping(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return { ok: true };
    } catch (err) {
      const message = describeError(err);
      this.logger.warn(`MinIO health check failed: ${message}`);
      return { ok: false, error: message };
    }
  }
}
