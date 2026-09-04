// The ONE decision about a media file's parent: what "standalone" is spelled
// as, and what happens to a linked file when its parent goes away.
//
// A media row hangs off a canyon, off a trip log, or off nothing. The third
// state is the user's own file — an import or a recorded track — and it is why
// those sync at all. A canyon's "way" is such a file with its parent SET, not a
// copy of one, so the parent moves in both directions over the file's life.
//
// The rule this file exists to hold in one place: DELETING A PARENT MUST NOT
// DESTROY A STANDALONE FILE. It is unlinked and survives in Saved, exactly as
// `Route.canyonId`'s SetNull already leaves a drawn route standing when its
// canyon is deleted. Three call sites need that (canyon delete, bulk canyon
// delete, way replacement) and each deciding for itself is how one of them ends
// up deleting the user's only copy of a file they imported.
//
// PRIVACY: unlinking is a visibility REVOCATION for the canyon's sharees. Every
// site here pairs the unlink with their tombstones in the same transaction —
// see lib/syncTombstones.ts.
import type { Prisma } from "@prisma/client";

/** The parent columns of a file that belongs to nobody but its owner. */
export const STANDALONE_LINK = {
  linkedType: "none",
  linkedId: null,
} as const;

/** Enough of a Media row to decide its fate. */
export type MediaLinkRow = { id: string; origin: string | null };

/**
 * Split a canyon's media into the rows that DIE with it and the rows that are
 * merely unlinked.
 *
 * `origin` is the whole test: a row with one is a standalone file the user
 * brought in or recorded, and it outlives every canyon it is ever attached to.
 * A row without one is a genuine attachment — a photo, a video — which has no
 * existence apart from the thing it is attached to.
 */
export function partitionCanyonMedia<Row extends MediaLinkRow>(
  rows: readonly Row[],
): { deleted: Row[]; unlinked: Row[] } {
  const deleted: Row[] = [];
  const unlinked: Row[] = [];
  for (const row of rows) {
    (row.origin === null ? deleted : unlinked).push(row);
  }
  return { deleted, unlinked };
}

/**
 * The canyon a media row hangs off, or null if it hangs off anything else — a
 * trip log, or nothing at all.
 *
 * Exists so the several places that fan visibility out to a canyon's sharees
 * narrow `linkedId` by asking what it MEANS rather than by asserting it is
 * non-null. `linkedType: "none"` rows have no parent, so a bare `!` at those
 * sites would be a latent crash the moment a standalone file reaches one.
 */
export function canyonIdOfMedia(row: {
  linkedType: string;
  linkedId: string | null;
}): string | null {
  return row.linkedType === "canyon" ? row.linkedId : null;
}

/**
 * Detach standalone files from parents that are going away, inside the
 * caller's transaction. No-op on [].
 *
 * Updates by ID rather than by parent so it cannot race a file that was
 * re-linked elsewhere between the read and the write.
 */
export async function unlinkStandaloneMedia(
  tx: Prisma.TransactionClient,
  mediaIds: readonly string[],
): Promise<void> {
  if (mediaIds.length === 0) return;
  await tx.media.updateMany({
    where: { id: { in: [...mediaIds] } },
    data: STANDALONE_LINK,
  });
}
