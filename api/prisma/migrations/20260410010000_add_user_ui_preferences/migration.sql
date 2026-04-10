ALTER TABLE "users"
ADD COLUMN "ui_preferences" JSONB NOT NULL DEFAULT '{}'::jsonb;
