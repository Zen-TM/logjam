-- AlterTable
ALTER TABLE "canyons" ADD COLUMN "ropewiki_id" INTEGER;
ALTER TABLE "canyons" ADD COLUMN "ropewiki_snapshot" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX "canyons_owner_id_ropewiki_id_key" ON "canyons"("owner_id", "ropewiki_id");
