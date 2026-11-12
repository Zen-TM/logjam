-- An export of an area carries its box; an export of a LiDAR job has none.
-- Expand only (ADR 0003): nullable, and nothing the running image reads.
ALTER TABLE "topo_export_jobs" ADD COLUMN "bbox" JSONB;
