-- Anchors: which vertices of a route the USER placed, as opposed to the ones
-- snapping filled in to follow a track.
--
-- Additive and nullable, so it is expand/contract safe: the currently-deployed
-- image neither reads nor writes it, and NULL is a meaningful value rather than
-- a placeholder — it means "no record", which every route drawn before snapping
-- existed legitimately has, and which reads as "every point is the user's".
ALTER TABLE "routes" ADD COLUMN "anchors" JSONB;
