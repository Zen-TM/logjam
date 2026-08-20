// Matching the map's search box against the user's OWN saved things.
//
// Its own module, free of React Native imports, so the ranking has a test: the
// order results come back in is the whole user-visible behaviour of a search
// box, and ordering built inline in a render is ordering nobody checks.
//
// The rule is deliberately dumb — case-insensitive substring, prefix matches
// first — because the corpus is one person's canyons and waypoints, not a
// document index. Fuzzy matching over forty rows buys nothing and starts
// answering "Claustral" with "Coal Mine".
//
// PRIVACY: this runs entirely on the device against the local mirror. It is
// what lets the search box answer a canyon name at all — sending one to
// Nominatim is exactly the thing the privacy rules forbid (see MapSearchBar).

/** Shortest query that searches saved items. Lower than the geocoder's own
 *  minimum: two letters is a plausible start of a name you already own, where
 *  it is a useless thing to send to a public gazetteer. */
export const LOCAL_QUERY_MIN_LENGTH = 2;

export type LocalSearchCandidate<T> = {
  /** What the user reads and, first of all, what they are typing. */
  title: string;
  /** Also matched, never displayed as the match: alt names, tags. */
  alternates?: readonly string[];
  value: T;
};

/**
 * Candidates whose title or alternates contain `query`, best first.
 *
 * "Best" is: a title that STARTS with the query, then a title that contains it,
 * then a match that was only in the alternates. Ties keep the caller's order,
 * which is the order the kinds were composed in — so canyons come before
 * waypoints for an equally good match, which is the order someone looking at a
 * map wants.
 */
export function rankLocalMatches<T>(
  query: string,
  candidates: readonly LocalSearchCandidate<T>[],
  limit: number,
): LocalSearchCandidate<T>[] {
  const needle = query.trim().toLowerCase();
  if (needle.length < LOCAL_QUERY_MIN_LENGTH) return [];

  const scored: { candidate: LocalSearchCandidate<T>; rank: number; at: number }[] = [];
  candidates.forEach((candidate, at) => {
    const title = candidate.title.toLowerCase();
    const titleAt = title.indexOf(needle);
    if (titleAt === 0) {
      scored.push({ candidate, rank: 0, at });
      return;
    }
    if (titleAt > 0) {
      scored.push({ candidate, rank: 1, at });
      return;
    }
    const inAlternate = (candidate.alternates ?? []).some((alternate) =>
      alternate.toLowerCase().includes(needle),
    );
    if (inAlternate) scored.push({ candidate, rank: 2, at });
  });

  // Sort by rank, then by the caller's own order — a stable sort would give the
  // second half for free, but Array.prototype.sort's stability is only
  // guaranteed since ES2019 engines and this is cheaper to read than to trust.
  scored.sort((a, b) => (a.rank === b.rank ? a.at - b.at : a.rank - b.rank));
  return scored.slice(0, limit).map((entry) => entry.candidate);
}
