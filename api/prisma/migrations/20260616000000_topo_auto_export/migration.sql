-- Auto-export for LiDAR topo jobs. A user pre-configures an export in the topo
-- Advanced settings dialog; once the topo job reaches "complete" the in-API
-- reaper queues a TopoExportJob from this config.

-- TopoJob: the captured export config + a dedup marker set when the reaper has
-- handled it (so overlapping sweeps can't double-queue).
ALTER TABLE "topo_jobs"
    ADD COLUMN "auto_export"      JSONB,
    ADD COLUMN "auto_exported_at" TIMESTAMP(3);

-- TopoTemplate: remember the auto-export config alongside the raster config.
ALTER TABLE "topo_templates"
    ADD COLUMN "auto_export" JSONB;
