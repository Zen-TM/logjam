-- DropForeignKey
ALTER TABLE "media" DROP CONSTRAINT "media_canyon_linked_id_fkey";

-- DropForeignKey
ALTER TABLE "media" DROP CONSTRAINT "media_triplog_linked_id_fkey";

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "storage_quota_bytes" SET DEFAULT 5368709120;

-- CreateIndex
CREATE INDEX "media_linked_type_linked_id_idx" ON "media"("linked_type", "linked_id");
