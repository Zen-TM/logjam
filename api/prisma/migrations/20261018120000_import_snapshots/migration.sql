-- What an import changed on a place or trip it merged into, so Undo can put
-- it back. EXPAND-ONLY: a new table the previous API never reads or writes.

-- CreateTable
CREATE TABLE "import_snapshots" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "place_id" TEXT,
    "trip_log_id" TEXT,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_snapshots_owner_id_batch_id_idx" ON "import_snapshots"("owner_id", "batch_id");

-- CreateIndex
CREATE INDEX "import_snapshots_place_id_idx" ON "import_snapshots"("place_id");

-- CreateIndex
CREATE INDEX "import_snapshots_trip_log_id_idx" ON "import_snapshots"("trip_log_id");

-- AddForeignKey
ALTER TABLE "import_snapshots" ADD CONSTRAINT "import_snapshots_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_snapshots" ADD CONSTRAINT "import_snapshots_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "places"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_snapshots" ADD CONSTRAINT "import_snapshots_trip_log_id_fkey" FOREIGN KEY ("trip_log_id") REFERENCES "trip_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

