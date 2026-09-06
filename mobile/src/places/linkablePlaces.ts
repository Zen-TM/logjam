// Which places the link picker offers, and how many it had to leave out.
//
// The picker is a flat `.map()` inside a sheet — no FlatList, no scroll of its
// own — so the list is capped. A cap with nothing said about it is a list that
// silently ends: a user with more than the cap sees an apparently complete
// picker missing everything past it, with no reason to reach for the filter.
// So the cap and the hidden count are computed together, in one pure function
// the sheet body only renders.

/** Beyond this the list is a scroll-hunt; the filter is the way through. */
export const VISIBLE_PLACES = 40;

type Linkable = { id: string; name: string; syncRole?: string | null };

export function linkablePlaces<T extends Linkable>(
  places: T[],
  query: string,
): { visible: T[]; hiddenCount: number } {
  const needle = query.trim().toLowerCase();
  const matches = places
    // Only places the user OWNS can take a link — the API refuses the rest,
    // so offering them would be a 400 waiting to happen.
    .filter((place) => place.syncRole !== "shared")
    .filter((place) => !needle || place.name.toLowerCase().includes(needle));
  return {
    visible: matches.slice(0, VISIBLE_PLACES),
    hiddenCount: Math.max(0, matches.length - VISIBLE_PLACES),
  };
}

/** Null when nothing was cut — the caller renders no row at all then. */
export function truncationHint(visibleCount: number, hiddenCount: number): string | null {
  if (hiddenCount <= 0) return null;
  return `Showing ${visibleCount} of ${visibleCount + hiddenCount} — keep typing to narrow it down.`;
}
