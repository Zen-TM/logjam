-- Plans. EXPAND-ONLY (ADR 0003): new tables, new nullable columns, and
-- owner columns widened to nullable. The previous API never writes a plan
-- row, so every row it writes still has an owner and satisfies the CHECKs.

-- AlterTable
ALTER TABLE "places" ADD COLUMN     "added_by_id" TEXT,
ADD COLUMN     "plan_id" TEXT,
ALTER COLUMN "owner_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "media" ADD COLUMN     "added_by_id" TEXT,
ADD COLUMN     "charged_to_id" TEXT,
ADD COLUMN     "plan_id" TEXT,
ALTER COLUMN "owner_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "routes" ADD COLUMN     "added_by_id" TEXT,
ADD COLUMN     "plan_id" TEXT,
ALTER COLUMN "owner_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "trip_plans" (
    "id" TEXT NOT NULL,
    "created_by_id" TEXT,
    "name" TEXT NOT NULL,
    "start_date" DATE,
    "end_date" DATE,
    "trip_types" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trip_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_plan_members" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "invited_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_plan_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_plan_invites" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_plan_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_plan_sections" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trip_plan_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_plan_forms" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "questions" JSONB NOT NULL DEFAULT '[]',
    "preset" TEXT,
    "visible_to" TEXT NOT NULL,
    "required_to_join" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trip_plan_forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_plan_answers" (
    "id" TEXT NOT NULL,
    "form_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trip_plan_answers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trip_plans_created_by_id_idx" ON "trip_plans"("created_by_id");

-- CreateIndex
CREATE INDEX "trip_plan_members_user_id_idx" ON "trip_plan_members"("user_id");

-- CreateIndex
CREATE INDEX "trip_plan_members_invited_by_id_idx" ON "trip_plan_members"("invited_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "trip_plan_members_plan_id_user_id_key" ON "trip_plan_members"("plan_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "trip_plan_invites_token_hash_key" ON "trip_plan_invites"("token_hash");

-- CreateIndex
CREATE INDEX "trip_plan_invites_plan_id_idx" ON "trip_plan_invites"("plan_id");

-- CreateIndex
CREATE INDEX "trip_plan_invites_created_by_id_idx" ON "trip_plan_invites"("created_by_id");

-- CreateIndex
CREATE INDEX "trip_plan_sections_plan_id_position_idx" ON "trip_plan_sections"("plan_id", "position");

-- CreateIndex
CREATE INDEX "trip_plan_forms_plan_id_position_idx" ON "trip_plan_forms"("plan_id", "position");

-- CreateIndex
CREATE INDEX "trip_plan_answers_user_id_idx" ON "trip_plan_answers"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "trip_plan_answers_form_id_user_id_key" ON "trip_plan_answers"("form_id", "user_id");

-- CreateIndex
CREATE INDEX "places_plan_id_idx" ON "places"("plan_id");

-- CreateIndex
CREATE INDEX "places_added_by_id_idx" ON "places"("added_by_id");

-- CreateIndex
CREATE INDEX "media_plan_id_idx" ON "media"("plan_id");

-- CreateIndex
CREATE INDEX "media_added_by_id_idx" ON "media"("added_by_id");

-- CreateIndex
CREATE INDEX "media_charged_to_id_idx" ON "media"("charged_to_id");

-- CreateIndex
CREATE INDEX "routes_plan_id_idx" ON "routes"("plan_id");

-- CreateIndex
CREATE INDEX "routes_added_by_id_idx" ON "routes"("added_by_id");

-- AddForeignKey
ALTER TABLE "places" ADD CONSTRAINT "places_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "trip_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "places" ADD CONSTRAINT "places_added_by_id_fkey" FOREIGN KEY ("added_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media" ADD CONSTRAINT "media_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "trip_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media" ADD CONSTRAINT "media_added_by_id_fkey" FOREIGN KEY ("added_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media" ADD CONSTRAINT "media_charged_to_id_fkey" FOREIGN KEY ("charged_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routes" ADD CONSTRAINT "routes_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "trip_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routes" ADD CONSTRAINT "routes_added_by_id_fkey" FOREIGN KEY ("added_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_plans" ADD CONSTRAINT "trip_plans_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_plan_members" ADD CONSTRAINT "trip_plan_members_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "trip_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_plan_members" ADD CONSTRAINT "trip_plan_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_plan_members" ADD CONSTRAINT "trip_plan_members_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_plan_invites" ADD CONSTRAINT "trip_plan_invites_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "trip_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_plan_invites" ADD CONSTRAINT "trip_plan_invites_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_plan_sections" ADD CONSTRAINT "trip_plan_sections_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "trip_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_plan_forms" ADD CONSTRAINT "trip_plan_forms_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "trip_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_plan_answers" ADD CONSTRAINT "trip_plan_answers_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "trip_plan_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_plan_answers" ADD CONSTRAINT "trip_plan_answers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A row belongs to a user or to a plan, never both, never neither. Prisma
-- cannot declare a CHECK, so these live only here.
-- Guard: src/__tests__/tripPlanRows.test.ts.
ALTER TABLE "places" ADD CONSTRAINT "places_one_owner" CHECK (num_nonnulls("owner_id", "plan_id") = 1);
ALTER TABLE "routes" ADD CONSTRAINT "routes_one_owner" CHECK (num_nonnulls("owner_id", "plan_id") = 1);
ALTER TABLE "media" ADD CONSTRAINT "media_one_owner" CHECK (num_nonnulls("owner_id", "plan_id") = 1);
