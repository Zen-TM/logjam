// What both clients do when a basemap's tile server is unreachable. Whether
// the phone or browser itself is offline is a different question and is the
// client's to answer first: an offline device marks nothing down.

export const BASEMAP_UNAVAILABLE_LABEL = "Not available right now";

/** Consecutive failed tile loads of the active basemap before it counts as down. */
export const BASEMAP_FAIL_AFTER = 3;

/** Whether a failed tile request says the server is down. A 404 is a tile the
 *  provider simply doesn't have (outside its coverage), not an outage; other
 *  4xx are a refusal, which a reachable server gives. */
export function isServerFault(status: number | null | undefined): boolean {
  return status == null || status === 0 || status >= 500;
}

/** `down` with `id` set or cleared; the same set back when nothing changes, so
 *  a state setter given it does not re-render. */
export function withBasemapDown(
  down: ReadonlySet<string>,
  id: string,
  isDown: boolean,
): ReadonlySet<string> {
  if (down.has(id) === isDown) return down;
  const next = new Set(down);
  if (isDown) next.add(id);
  else next.delete(id);
  return next;
}

/** The basemap to draw: the user's pick, or `fallback` while the pick is down.
 *  The pick itself is never changed, so it returns when the server does. */
export function basemapToShow(
  picked: string,
  down: ReadonlySet<string>,
  fallback: string,
): string {
  return down.has(picked) && picked !== fallback && !down.has(fallback)
    ? fallback
    : picked;
}

export function basemapFallbackNotice(name: string, fallbackName: string) {
  return `${name} isn't available right now. Showing ${fallbackName} instead.`;
}
