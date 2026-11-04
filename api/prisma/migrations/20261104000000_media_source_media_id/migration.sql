-- A trip's copy of a recorded track names the recording it came from, so the
-- recording stops offering "Log a trip". Expand-only (ADR 0003): a nullable
-- column the running image neither reads nor writes. No foreign key, like
-- linked_id: SetNull would clear it without bumping updated_at, so the delta
-- would never tell the phone, and a dangling id is harmless (it matches no
-- recording). Copies made before this have no link and stay null.
ALTER TABLE "media" ADD COLUMN "source_media_id" TEXT;
