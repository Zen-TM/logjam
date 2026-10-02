-- Rollback drill: must turn Rollback compat red. Never merge.
ALTER TABLE "users" DROP COLUMN "vector_style";
