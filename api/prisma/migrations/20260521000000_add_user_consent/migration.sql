ALTER TABLE "users"
  ADD COLUMN "consented_at" TIMESTAMP(3),
  ADD COLUMN "consent_version" TEXT;
