-- AlterTable
ALTER TABLE "topo_jobs" ADD COLUMN     "output_tile_count" INTEGER,
ADD COLUMN     "pipeline_metrics" JSONB,
ADD COLUMN     "render_tiles_done" INTEGER,
ADD COLUMN     "render_tiles_total" INTEGER,
ADD COLUMN     "last_progress_at" TIMESTAMP(3);
