-- Delta-sync watermark columns (Stage 8). Added WITH a database default,
-- deliberately kept (not dropped after backfill): the currently-deployed image
-- inserts rows without updated_at during the deploy swap window
-- (expand/contract rule — a NOT NULL column with no default would fail those
-- inserts). Prisma's @updatedAt sets the value explicitly on every
-- create/update, so the default only ever covers old-image inserts.
-- Existing rows are backfilled from created_at, not now(), so a client's
-- first delta cursor doesn't see the whole table as freshly changed.

-- AlterTable
ALTER TABLE "friendships" ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "friendships" SET "updated_at" = "created_at";

-- AlterTable
ALTER TABLE "trip_logs" ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "trip_logs" SET "updated_at" = "created_at";

-- CreateTable
CREATE TABLE "waypoints" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "canyon_id" TEXT,
    "name" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "elevation" DOUBLE PRECISION,
    "symbol" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "waypoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_tombstones" (
    "id" BIGSERIAL NOT NULL,
    "user_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "deleted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_tombstones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "waypoints_owner_id_idx" ON "waypoints"("owner_id");

-- CreateIndex
CREATE INDEX "waypoints_canyon_id_idx" ON "waypoints"("canyon_id");

-- CreateIndex
CREATE INDEX "sync_tombstones_user_id_deleted_at_idx" ON "sync_tombstones"("user_id", "deleted_at");

-- AddForeignKey
ALTER TABLE "waypoints" ADD CONSTRAINT "waypoints_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waypoints" ADD CONSTRAINT "waypoints_canyon_id_fkey" FOREIGN KEY ("canyon_id") REFERENCES "canyons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_tombstones" ADD CONSTRAINT "sync_tombstones_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
