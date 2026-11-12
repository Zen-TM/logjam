-- Expand/contract step 2 of 4 for User.subject (ADR 0003). The image that ran
-- while the previous migration applied wrote only cognito_id, so a row it
-- created during that swap has no subject, and one it rebound has the old one.
UPDATE "users" SET "subject" = "cognito_id" WHERE "subject" IS DISTINCT FROM "cognito_id";

ALTER TABLE "users" ALTER COLUMN "subject" SET NOT NULL;
