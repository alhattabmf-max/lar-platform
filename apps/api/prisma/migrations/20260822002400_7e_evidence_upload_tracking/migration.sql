CREATE TABLE "evidence_uploads" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "storage_object_key" TEXT NOT NULL,
    "uploaded_by_user_id" UUID NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INT NOT NULL,
    "used_in_dispute_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_uploads_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "evidence_uploads_storage_object_key_key" ON "evidence_uploads"("storage_object_key");
ALTER TABLE "evidence_uploads" ADD CONSTRAINT "evidence_uploads_used_in_dispute_id_fkey"
  FOREIGN KEY ("used_in_dispute_id") REFERENCES "disputes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "evidence_uploads" ADD CONSTRAINT "evidence_uploads_content_type_allowed"
  CHECK ("content_type" IN ('image/jpeg', 'image/png', 'application/pdf'));
ALTER TABLE "evidence_uploads" ADD CONSTRAINT "evidence_uploads_size_bounds"
  CHECK ("size_bytes" > 0 AND "size_bytes" <= 10485760); -- 10 MiB ceiling
