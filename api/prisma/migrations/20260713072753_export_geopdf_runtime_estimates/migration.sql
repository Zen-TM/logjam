-- AlterTable
ALTER TABLE "geo_pdf_jobs" ADD COLUMN     "estimated_seconds" INTEGER;

-- AlterTable
ALTER TABLE "topo_export_jobs" ADD COLUMN     "estimated_seconds" INTEGER,
ADD COLUMN     "source_tile_count" INTEGER;
