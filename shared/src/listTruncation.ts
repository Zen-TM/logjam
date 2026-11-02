// The one sentence both clients say when a capped list left rows out, so a
// list that ends early is never mistaken for a complete one.

/** Null when nothing was cut: the caller renders no row at all then. */
export function truncationHint(
  visibleCount: number,
  hiddenCount: number,
): string | null {
  if (hiddenCount <= 0) return null;
  return `Showing ${visibleCount} of ${visibleCount + hiddenCount} — keep typing to narrow it down.`;
}

/** `GET /friends/search` returns at most this many users. */
export const FRIEND_SEARCH_CAP = 10;

/**
 * The hint under friend-search results. `total` is the `X-Total-Count` the API
 * sends beside them, null from an older API that does not: then a full page is
 * the only sign something may be missing. `omitted` is how many of the
 * returned users are drawn somewhere else (a plan's friends, listed above the
 * results): `shown` counts only the rows under the hint, and with none under
 * it there is nothing to say a list was cut short.
 */
export function friendSearchHint(
  shown: number,
  total: number | null,
  omitted = 0,
): string | null {
  if (shown === 0) return null;
  if (total !== null) return truncationHint(shown, total - omitted - shown);
  return shown + omitted >= FRIEND_SEARCH_CAP
    ? `Showing the first ${shown} — keep typing to narrow it down.`
    : null;
}
