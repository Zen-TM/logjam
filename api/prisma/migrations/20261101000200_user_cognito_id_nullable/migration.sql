-- Expand/contract step 3 of 4 for User.subject (ADR 0003). The code stops
-- writing cognito_id, so rows it creates carry none; the image still running
-- while this applies writes both, which the nullable column also accepts.
ALTER TABLE "users" ALTER COLUMN "cognito_id" DROP NOT NULL;
