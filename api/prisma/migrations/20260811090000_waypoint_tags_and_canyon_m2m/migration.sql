-- Waypoints gain free-text tags, and their single optional canyon becomes a
-- many-to-many link (one carpark serves several canyons off one trailhead).

-- AlterTable
ALTER TABLE "waypoints" ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "canyon_waypoints" (
    "canyon_id" TEXT NOT NULL,
    "waypoint_id" TEXT NOT NULL,

    CONSTRAINT "canyon_waypoints_pkey" PRIMARY KEY ("canyon_id","waypoint_id")
);

-- CreateIndex
CREATE INDEX "canyon_waypoints_waypoint_id_idx" ON "canyon_waypoints"("waypoint_id");

-- AddForeignKey
-- Cascade both ways deletes the LINK only: a canyon delete leaves its
-- waypoints alive and standalone, which is what the old SetNull canyon_id did.
ALTER TABLE "canyon_waypoints" ADD CONSTRAINT "canyon_waypoints_canyon_id_fkey" FOREIGN KEY ("canyon_id") REFERENCES "canyons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canyon_waypoints" ADD CONSTRAINT "canyon_waypoints_waypoint_id_fkey" FOREIGN KEY ("waypoint_id") REFERENCES "waypoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Carry every existing association over.
INSERT INTO "canyon_waypoints" ("canyon_id", "waypoint_id")
SELECT "canyon_id", "id" FROM "waypoints" WHERE "canyon_id" IS NOT NULL;

-- EXPAND ONLY — "waypoints"."canyon_id" deliberately SURVIVES this migration.
-- Prod applies migrations BEFORE the new image serves, so the currently-running
-- image reads that column during the swap window; dropping it here would break
-- it mid-deploy (api/CLAUDE.md, expand/contract). The column is dead to the new
-- code from this commit on. Drop it in a SEPARATE, LATER migration once no
-- running image reads it — see the CONTRACT note on model Waypoint.
