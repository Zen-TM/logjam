-- Reconciles three statements that `schema.prisma` has declared since the
-- 2026-07-23 stage8 migration but that no migration ever applied. A database
-- built from this history did NOT match one built from the schema file, so
-- `prisma migrate dev` folded these into whatever unrelated feature migration
-- was being generated (it did exactly that to the sharing migration on
-- 2026-08-22, where they were stripped by hand). Applying them once stops that.
--
-- Expand/contract (api/CLAUDE.md): all three are safe for the currently-running
-- image. Dropping an index changes no behaviour, and the two DEFAULTs are only
-- reachable by an INSERT that omits `updated_at` — Prisma's `@updatedAt` always
-- supplies it, and the API contains no raw INSERT into either table (the only
-- raw SQL is `SELECT … FOR UPDATE` and the storage-quota UPDATEs on `users`).

-- Index on Waypoint.canyonId, the column marked `@deprecated — never read or
-- written` when waypoints moved to the CanyonWaypoint join table. Nothing has
-- queried it since; it only cost write throughput.
DROP INDEX IF EXISTS "waypoints_canyon_id_idx";

-- `updated_at` on both tables was added NOT NULL with a CURRENT_TIMESTAMP
-- default purely so the backfilling ADD COLUMN could succeed. The schema
-- declares `@updatedAt` with no default, and leaving the default in place lets
-- a hand-written INSERT silently get a wrong watermark — which for a
-- delta-synced table means a row that never reaches a client's next pull.
ALTER TABLE "friendships" ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "trip_logs" ALTER COLUMN "updated_at" DROP DEFAULT;
