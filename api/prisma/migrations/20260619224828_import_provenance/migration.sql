-- AlterTable
ALTER TABLE "canyons" ADD COLUMN     "import_batch_id" TEXT,
ADD COLUMN     "import_key" TEXT;

-- AlterTable
ALTER TABLE "trip_logs" ADD COLUMN     "import_batch_id" TEXT,
ADD COLUMN     "import_key" TEXT;

-- CreateIndex
CREATE INDEX "canyons_owner_id_import_batch_id_idx" ON "canyons"("owner_id", "import_batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "canyons_owner_id_import_key_key" ON "canyons"("owner_id", "import_key");

-- CreateIndex
CREATE INDEX "trip_logs_user_id_import_batch_id_idx" ON "trip_logs"("user_id", "import_batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "trip_logs_user_id_import_key_key" ON "trip_logs"("user_id", "import_key");

