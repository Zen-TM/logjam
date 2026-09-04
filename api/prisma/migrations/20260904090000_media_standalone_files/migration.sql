-- Let a media file belong to nobody but its owner, so imports and recorded
-- tracks can sync.
--
-- Every media row previously needed a parent (a canyon or a trip log), so a
-- file the user simply OWNED had nowhere to live: imports and recordings stayed
-- on the phone, and attaching an import to a canyon uploaded a second COPY of
-- it. linked_type "none" (with a null linked_id) is that missing third state.

-- A standalone file's parent is null. Existing rows all have one, so nothing
-- is rewritten here.
ALTER TABLE "media" ALTER COLUMN "linked_id" DROP NOT NULL;

-- "import" | "track" for a standalone file; null for a canyon/trip attachment.
-- An imported GPX and a recorded one are the same MIME type and different rows
-- in the Saved list, so the distinction cannot be derived.
ALTER TABLE "media" ADD COLUMN "origin" TEXT;

-- Row-level stats (bbox, distance, duration, counts) so a second device can
-- list a file without downloading it. Shape enforced by parseMediaMetadata
-- (shared/src/mediaMetadata.ts), not by the column.
ALTER TABLE "media" ADD COLUMN "metadata" JSONB NOT NULL DEFAULT '{}';

-- Delta-sync watermark. Media rows used to be immutable, so the delta keyset
-- ran on created_at; link/unlink makes them mutable, and a created_at keyset
-- would never redeliver a re-parented row — the other device would show a
-- stale parent forever. Backfilled from created_at so existing rows keep their
-- position in the keyset rather than all jumping to the head of it.
ALTER TABLE "media" ADD COLUMN "updated_at" TIMESTAMP(3);
UPDATE "media" SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;
ALTER TABLE "media" ALTER COLUMN "updated_at" SET NOT NULL;
ALTER TABLE "media" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;

-- The user-facing label of a standalone file. `filename` cannot serve: it is
-- the file's own name, must keep its extension, and a rename must not change
-- what the download is called. Null falls back to the filename.
ALTER TABLE "media" ADD COLUMN "display_name" TEXT;
