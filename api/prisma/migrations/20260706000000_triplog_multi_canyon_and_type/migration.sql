-- Trip logs go many-to-many with canyons, gain an optional activity `type`.
-- Single-cutover migration, hand-ordered so the backfill runs between the
-- join-table creation and the canyon_id drop:
--   1. create trip_log_canyons
--   2. backfill one join row per canyon-linked trip (position 0)
--   3. backfill type = 'canyoning' for canyon-linked trips (heuristic: every
--      pre-existing canyon-linked trip was a canyoning trip)
--   4. drop trip_logs.canyon_id

-- CreateTable
CREATE TABLE "trip_log_canyons" (
    "trip_log_id" TEXT NOT NULL,
    "canyon_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "trip_log_canyons_pkey" PRIMARY KEY ("trip_log_id","canyon_id")
);

-- CreateIndex
CREATE INDEX "trip_log_canyons_canyon_id_idx" ON "trip_log_canyons"("canyon_id");

-- AddForeignKey
ALTER TABLE "trip_log_canyons" ADD CONSTRAINT "trip_log_canyons_trip_log_id_fkey" FOREIGN KEY ("trip_log_id") REFERENCES "trip_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_log_canyons" ADD CONSTRAINT "trip_log_canyons_canyon_id_fkey" FOREIGN KEY ("canyon_id") REFERENCES "canyons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable (add type before backfill references it)
ALTER TABLE "trip_logs" ADD COLUMN "type" TEXT;

-- Backfill: one join row per canyon-linked trip
INSERT INTO "trip_log_canyons" ("trip_log_id", "canyon_id", "position")
SELECT "id", "canyon_id", 0 FROM "trip_logs" WHERE "canyon_id" IS NOT NULL;

-- Backfill: canyon-linked trips were canyoning trips
UPDATE "trip_logs" SET "type" = 'canyoning' WHERE "canyon_id" IS NOT NULL;

-- DropForeignKey
ALTER TABLE "trip_logs" DROP CONSTRAINT "trip_logs_canyon_id_fkey";

-- DropIndex
DROP INDEX "trip_logs_canyon_id_idx";

-- AlterTable
ALTER TABLE "trip_logs" DROP COLUMN "canyon_id";
