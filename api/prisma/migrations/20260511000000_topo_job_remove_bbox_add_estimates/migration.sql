ALTER TABLE "topo_jobs"
  DROP COLUMN "bbox",
  ADD COLUMN "name" TEXT,
  ADD COLUMN "tile_count" INTEGER,
  ADD COLUMN "estimated_seconds" INTEGER;
