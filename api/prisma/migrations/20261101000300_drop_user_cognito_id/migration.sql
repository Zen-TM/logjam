-- Contract step 4 of 4 for User.subject (ADR 0003). No running image reads or
-- writes cognito_id any more.
DROP INDEX "users_cognito_id_key";

ALTER TABLE "users" DROP COLUMN "cognito_id";
