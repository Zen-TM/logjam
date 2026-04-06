/*
  Warnings:

  - You are about to drop the column `s3_output_key` on the `topo_jobs` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "topo_jobs" DROP COLUMN "s3_output_key",
ADD COLUMN     "bbox" JSONB,
ADD COLUMN     "layer_options" JSONB,
ADD COLUMN     "s3_output_keys" JSONB,
ALTER COLUMN "status" SET DEFAULT 'uploading';
