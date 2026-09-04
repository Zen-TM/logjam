// The Saved tab's category vocabulary and row-key spelling, in ONE place.
//
// Split out of `SavedScreen.tsx` because two other places need it and neither
// may import that file: `notifications/notificationDestination.ts` is RN-free
// so vitest can parse it, and `AppShell.tsx` types the `SavedHome` route params
// with it. A second hand-kept copy of either list is exactly the drift the root
// CLAUDE.md's "two lists that must agree" rule is about — a category added here
// breaks `CATEGORY_META`'s `Record<Category, …>` in SavedScreen until it is
// described there too, which is the executable half of that rule.
import type { SharableEntityType } from "@logjam/shared";

/** One entry per asset kind the Saved tab lists. Reading order lives with the
 *  rail (`CATEGORY_ORDER` in SavedScreen); this is the SET. */
export const SAVED_CATEGORIES = [
  "region",
  "overlay",
  "geoPdf",
  "route",
  "waypoint",
  "import",
  "track",
] as const;

export type SavedCategory = (typeof SAVED_CATEGORIES)[number];

/**
 * Which kinds live in the user's ACCOUNT and which live only on this handset.
 *
 * One rule, and it fits in a sentence the user can hold: **things you made
 * sync, maps you downloaded stay on this device.** Waypoints, routes, imports
 * and recordings are the user's own records. Regions, LiDAR topos and GeoPDFs
 * are map material obtained from somewhere else — re-downloadable anywhere,
 * enormous, and pointless to copy between devices.
 *
 * It is a `Record<SavedCategory, …>` so a new category cannot be added without
 * answering the question; `savedKeys.test.ts` is the other half, pinning the
 * actual split rather than only its completeness. It lives HERE rather than in
 * SavedScreen's `CATEGORY_META` because this file is RN-free and therefore
 * testable, and because the boundary is a fact about the product, not about one
 * screen's presentation of it.
 */
export const CATEGORY_SYNCS: Record<SavedCategory, boolean> = {
  region: false,
  overlay: false,
  geoPdf: false,
  route: true,
  waypoint: true,
  import: true,
  track: true,
};

/**
 * A LiDAR topo job's row key.
 *
 * A topo job is many artifacts (one per layer) shown as one card, so its row is
 * keyed by the job rather than by any file — and the prefix keeps it from
 * colliding with a waypoint or route id in the same key space. Spelled here
 * because the notification inbox builds the same key to point at the row
 * without owning how it is made.
 */
export function savedOverlayKey(jobId: string): string {
  return `overlay:${jobId}`;
}

/** The region twin of `savedOverlayKey`, for the same reason. */
export function savedRegionKey(groupKey: string): string {
  return `region:${groupKey}`;
}

/**
 * Where a directly-shared item lives in Saved, and which row it is.
 *
 * The four sharable entity types are the four this has to answer for; a
 * `Record` rather than a switch so adding one to `SHARABLE_ENTITY_TYPES` fails
 * to compile until it is placed.
 *
 * `key` may name a row that is not on this device yet (a topo job still to be
 * downloaded, a GeoPDF still in the account) — those rows carry the same key in
 * their own sections, so the pointer holds either way.
 */
export const SHARED_ENTITY_LOCATION: Record<
  SharableEntityType,
  { category: SavedCategory; key: (entityId: string) => string }
> = {
  waypoint: { category: "waypoint", key: (id) => id },
  route: { category: "route", key: (id) => id },
  topoJob: { category: "overlay", key: savedOverlayKey },
  // The account-jobs section keys its rows by the JOB id. Once the job has been
  // imported to this device the row is a local import with an id of its own, so
  // the pointer lands on the right filter and simply does not pulse.
  geoPdfJob: { category: "geoPdf", key: (id) => id },
};
