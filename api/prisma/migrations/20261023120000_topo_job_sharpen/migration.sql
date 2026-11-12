-- Marks a LiDAR job to sharpen, then holds the sharpened result. EXPAND-ONLY:
-- a nullable column the previous API never reads or writes.

-- AlterTable
ALTER TABLE "topo_jobs" ADD COLUMN "sharpen" JSONB;
