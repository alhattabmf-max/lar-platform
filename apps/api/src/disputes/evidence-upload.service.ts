import { Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import { PrismaService } from "../database/prisma.service";
import { StorageService } from "../storage/storage.service";
import { BusinessException } from "../common/errors/business-exception";
import { ERROR_CODES } from "@platform/types";

interface ActorContext {
  userId: string;
  requestId: string;
}

const ALLOWED_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "application/pdf"]);
const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MiB
const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "application/pdf": "pdf",
};

@Injectable()
export class EvidenceUploadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService
  ) {}

  async upload(buffer: Buffer, contentType: string, ctx: ActorContext) {
    if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
      throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "File type not allowed — only JPEG, PNG, or PDF");
    }
    if (buffer.length === 0 || buffer.length > MAX_SIZE_BYTES) {
      throw new BusinessException(400, ERROR_CODES.VALIDATION_FAILED, "File size out of allowed bounds");
    }

    const extension = EXTENSION_BY_CONTENT_TYPE[contentType];
    const storageObjectKey = `dispute-evidence/${ctx.userId}/${randomUUID()}.${extension}`;
    await this.storage.upload(storageObjectKey, buffer, contentType);

    // Only contentType and sizeBytes are persisted — no EXIF or other
    // file-embedded metadata is ever read or stored.
    return this.prisma.evidenceUpload.create({
      data: { storageObjectKey, uploadedByUserId: ctx.userId, contentType, sizeBytes: buffer.length },
    });
  }
}
