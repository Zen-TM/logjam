-- CreateTable
CREATE TABLE "routes" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "canyon_id" TEXT,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "points" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "routes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- One route per canyon, enforced in the DB. Postgres allows many NULLs in a
-- unique column, so unlinked routes stay unconstrained.
CREATE UNIQUE INDEX "routes_canyon_id_key" ON "routes"("canyon_id");

-- CreateIndex
CREATE INDEX "routes_owner_id_idx" ON "routes"("owner_id");

-- AddForeignKey
ALTER TABLE "routes" ADD CONSTRAINT "routes_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- SetNull: routes outlive the canyon they were attached to.
ALTER TABLE "routes" ADD CONSTRAINT "routes_canyon_id_fkey" FOREIGN KEY ("canyon_id") REFERENCES "canyons"("id") ON DELETE SET NULL ON UPDATE CASCADE;
