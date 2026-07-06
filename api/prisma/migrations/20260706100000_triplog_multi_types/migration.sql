-- Trip type goes single → multiple: types text[] preserving existing values.
ALTER TABLE "trip_logs" ADD COLUMN "types" TEXT[] NOT NULL DEFAULT '{}';
UPDATE "trip_logs" SET "types" = ARRAY["type"] WHERE "type" IS NOT NULL;
ALTER TABLE "trip_logs" DROP COLUMN "type";
