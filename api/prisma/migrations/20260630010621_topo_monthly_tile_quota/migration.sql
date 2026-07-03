-- Rename the weekly tile quota to a monthly quota and tighten the cap to 40.
-- RENAME COLUMN (not drop/add) preserves any per-user overrides; the UPDATE then
-- resets every existing row to the new flat default of 40.
ALTER TABLE "users" RENAME COLUMN "weekly_tile_quota" TO "monthly_tile_quota";
ALTER TABLE "users" ALTER COLUMN "monthly_tile_quota" SET DEFAULT 40;
UPDATE "users" SET "monthly_tile_quota" = 40;
