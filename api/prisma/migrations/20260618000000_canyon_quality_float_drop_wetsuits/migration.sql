-- Quality becomes a decimal (1-5) instead of an integer rating.
ALTER TABLE "canyons" ALTER COLUMN "quality" SET DATA TYPE DOUBLE PRECISION;

-- Wetsuits is no longer a fixed field; users who want it add a custom field.
-- Existing values are intentionally discarded.
ALTER TABLE "canyons" DROP COLUMN "wetsuits";
