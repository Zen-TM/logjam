// Scrubbing a deleted place out of the mirror's JSON link columns.
//
// TRIPS link to places with their names, for the derived title
// (`trip_logs.places_json`, a {id,name}[]). It is a JSON text column, so a
// place delete cannot be a foreign-key cascade — it is a read, a filter and a
// rewrite, in two places (the server tombstone and the local delete) that must
// not diverge.
//
// Place↔place links are NOT here: they became rows of their own
// (`place_links`) in the phase 1c fold, so the cascade deletes them outright.
//
// Pure and mobile-local: this is the shape of the MIRROR's columns, not
// business logic the web client shares.

/** A trip's place links, ordered — order drives the derived title. */
export type TripPlaceLink = { id: string; name: string };

function parseArray(raw: string | null): unknown[] | null {
  if (raw == null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    // Unparseable link column: leave it alone rather than replacing the
    // user's row with a guess. Never log it — it names places.
    return null;
  }
}

/**
 * `raw` with the link to `placeId` removed, or null when nothing changes (the
 * id isn't there, or the column doesn't hold a list). Null means "skip the
 * UPDATE", which keeps the caller's SQL out of rows it has no business
 * rewriting — the `LIKE %id%` prefilter the call sites use matches substrings
 * too.
 */
export function withoutPlaceLink(raw: string | null, placeId: string): string | null {
  const list = parseArray(raw) as TripPlaceLink[] | null;
  if (list === null) return null;
  const kept = list.filter((link) => link?.id !== placeId);
  return kept.length === list.length ? null : JSON.stringify(kept);
}
