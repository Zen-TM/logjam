-- Expand step 1 of 4 for User.cognitoId -> User.subject (ADR 0003). The running
-- image knows only cognito_id and leaves subject NULL; a later migration fills
-- the rows it creates meanwhile.
ALTER TABLE "users" ADD COLUMN "subject" TEXT;

UPDATE "users" SET "subject" = "cognito_id";

CREATE UNIQUE INDEX "users_subject_key" ON "users"("subject");
