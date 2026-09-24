// The Ways page's decisions, kept out of the component so they can be tested:
// what a "way" is, which kinds exist, and how four sources become one list.
//
// Ways answers "what lines have I got?" — routes I drew, tracks I recorded,
// files I imported (DESIGN.md §1). Logjam GPS answers the same question on its
// Saved tab, and its vocabulary is the one used here: `CATEGORY_META` in
// `mobile/src/saved/savedKeys.ts` names them Routes, Tracks and Imports.
//
// A track on a place a FRIEND shared reaches this page through
// `GET /places/tracks`, which is the only surface that carries it — it is not
// one of the user's own files and appears nowhere else. It is an ordinary
// Track or Import here, not a kind of its own: the endpoint now returns the
// file's name and `origin` alongside its colour, so there is nothing left that
// makes it a different sort of thing. It used to return a place id, a media id
// and a colour, which is why Ways briefly had a fourth chip named for where a
// file lived rather than for what it was (operator, 2026-09-17).
import {
  mediaDisplayName,
  routeLengthM,
  type StandaloneFile,
} from "@logjam/shared";
import type { PlaceTrack, TRoute } from "../../../placeUtils";

/**
 * The kinds of line, in the order the rail offers them. Routes first: they are
 * the only kind authored here, and the only one this page can create.
 */
export const WAY_KINDS = ["route", "track", "import"] as const;

export type WayKind = (typeof WAY_KINDS)[number];

/** The rail's words — Logjam GPS's own (`CATEGORY_META`). Plural, because a
 *  chip labels a group. Each names what a thing IS; where it lives is a
 *  property of the row, never a category beside these. */
export const WAY_KIND_LABELS: Record<WayKind, string> = {
  route: "Routes",
  track: "Tracks",
  import: "Imports",
};

/** One row on the page, whatever it was built from. */
export type WayItem = {
  /** Stable across renders and unique across kinds, which share an id space. */
  key: string;
  kind: WayKind;
  /** The route id, the media id, or the place id for a place's track. */
  id: string;
  title: string;
  /** Its length, where the source knows one. Routes always do — the geometry is
   *  here; an imported file only carries one if the recorder wrote it. */
  distanceM: number | null;
  color: string | null;
  /** Someone else owns this: a route shared with the user, or a track on a
   *  place a friend shared. Every write verb is absent on one. */
  shared: boolean;
  /**
   * This way reaches the user THROUGH a shared place rather than on its own.
   *
   * The difference is what can be done about it: a directly-shared way has a
   * share row of its own and the user can drop it ("Remove"), while one seen
   * through a place has none — the only way to stop seeing it is to remove the
   * PLACE, and offering Remove here would be a button that cannot work. Both
   * surfaces used to re-derive this from `sharedPlaces`, and only the detail
   * page got it right (operator, 2026-09-17).
   */
  viaPlace: boolean;
  /** The place this way belongs to, where it belongs to one. */
  placeId: string | null;
  /**
   * When it came into the account, which is what the list is ordered by.
   *
   * Null for a track on someone else's place: `/places/tracks` returns no date
   * (it is the place's endpoint, not the file's), and inventing one would sort
   * those rows somewhere that means nothing. They fall to the bottom instead.
   */
  createdAt: string | null;
  /**
   * The way's extent, `[west, south, east, north]` — what opening it fits the
   * map to. A route's comes from the geometry in hand; a file's is the bbox its
   * row already carries, so centring one costs no download.
   */
  bounds: [number, number, number, number] | null;
};

/** The box around a line. Null for a line with no points to bound. */
function boundsOfPoints(
  points: readonly [number, number][],
): [number, number, number, number] | null {
  if (points.length === 0) return null;
  const lngs = points.map(([lng]) => lng);
  const lats = points.map(([, lat]) => lat);
  return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
}

/**
 * Every way the user can see, as one list.
 *
 * De-duplicated by media id: the user's OWN file linked to their own place is
 * returned by both `/media/standalone` (carrying its name and origin) and
 * `/places/tracks` (carrying neither), and listing it twice is what the two
 * endpoints' overlap would otherwise produce. The richer row wins, so the one
 * that survives is the one that knows what the file is called.
 */
/**
 * One drawn route as a way.
 *
 * Its own function because a route reaches a page from two directions — a row
 * on this list, and its line tapped on the map — and both must produce the same
 * thing. Built twice, they drifted on the two fields a page actually uses: what
 * it is CALLED and what the map should fit to.
 */
export function wayFromRoute(
  route: TRoute,
  currentUserId: string | null,
  /** The places shared WITH the user. A shared route sitting on one of them
   *  arrived through that place, not through a share of its own. Required
   *  rather than defaulted: an empty set is a real answer ("none are shared"),
   *  and defaulting would let a caller forget and silently get it wrong. */
  sharedPlaceIds: ReadonlySet<string>,
): WayItem {
  const shared = currentUserId !== null && route.ownerId !== currentUserId;
  return {
    key: `route-${route.id}`,
    kind: "route",
    id: route.id,
    title: route.name,
    distanceM: routeLengthM(route.points),
    color: route.color,
    shared,
    viaPlace: shared && route.placeId !== null && sharedPlaceIds.has(route.placeId),
    placeId: route.placeId,
    createdAt: route.createdAt,
    bounds: boundsOfPoints(route.points),
  };
}

export function buildWays({
  routes,
  standaloneFiles,
  placeTracks,
  currentUserId,
  sharedPlaceIds,
}: {
  routes: readonly TRoute[];
  standaloneFiles: readonly StandaloneFile[];
  placeTracks: readonly PlaceTrack[];
  currentUserId: string | null;
  /** Ids of the places shared WITH the user — what tells a route shared on its
   *  own from one seen through somebody's place (`WayItem.viaPlace`). */
  sharedPlaceIds: ReadonlySet<string>;
}): WayItem[] {
  const fileIds = new Set(standaloneFiles.map((file) => file.id));
  // NEWEST FIRST, across every source — the list was routes, then files, then
  // a friend's tracks, which is the order they were fetched in and means
  // nothing to the reader (operator, 2026-09-17). A recording made this morning
  // belongs at the top whatever produced it. Undated rows keep their relative
  // order at the bottom, which `Array.prototype.sort`'s stability guarantees.
  return sortNewestFirst([
    ...routes.map((route) => wayFromRoute(route, currentUserId, sharedPlaceIds)),
    ...standaloneFiles.map(
      (file): WayItem => ({
        key: `file-${file.id}`,
        // The file's own account of itself. A recording and an import are
        // different things to their owner — one is where they went, the other
        // is where someone else went — so the row says which.
        kind: file.origin === "track" ? "track" : "import",
        id: file.id,
        title: mediaDisplayName(file),
        distanceM: file.metadata.distanceM ?? null,
        color: file.color,
        // Standalone files are the user's own by definition: the endpoint is
        // scoped to the caller, and a friend's file arrives as a copy.
        shared: false,
        viaPlace: false,
        placeId: file.linkedPlaceId,
        createdAt: file.createdAt,
        bounds: file.metadata.bbox ?? null,
      }),
    ),
    ...placeTracks
      .filter((track) => !fileIds.has(track.mediaId))
      .map(
        (track): WayItem => ({
          key: `place-track-${track.mediaId}`,
          // The file's own account of itself, exactly as a standalone file's
          // is. Where it lives shows as its place, on the row.
          kind: track.origin === "track" ? "track" : "import",
          id: track.mediaId,
          title: mediaDisplayName(track),
          distanceM: track.metadata.distanceM ?? null,
          color: track.color,
          // Everything left after the de-duplication above is a track on a
          // place the user does not own — their own come back from
          // `/media/standalone` as well, and that row wins.
          shared: true,
          // `/places/tracks` is the place's endpoint: a file here has no share
          // row of its own, and the place's share is the only thing holding it.
          viaPlace: true,
          placeId: track.placeId,
          // `/places/tracks` carries no date; these sort last (see WayItem).
          createdAt: null,
          bounds: track.metadata.bbox ?? null,
        }),
      ),
  ]);
}

/** Newest first, with the undated last. Stable, so rows that cannot be ordered
 *  against each other keep the order they arrived in. */
function sortNewestFirst(ways: WayItem[]): WayItem[] {
  return ways.sort((a, b) => {
    if (a.createdAt === b.createdAt) return 0;
    if (a.createdAt === null) return 1;
    if (b.createdAt === null) return -1;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

/** Whether a way matches what was typed. Name only: a way has no other text. */
export function wayMatchesSearch(way: WayItem, query: string): boolean {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return true;
  return way.title.toLowerCase().includes(trimmed);
}

/**
 * How many ways each chip would show, applying every axis BUT its own — so a
 * chip's count answers "how many would I get if I pressed this" rather than
 * restating the current view (DESIGN.md §3).
 */
export function wayKindCounts(
  ways: readonly WayItem[],
): { all: number } & Record<WayKind, number> {
  const counts = { all: ways.length, route: 0, track: 0, import: 0 };
  for (const way of ways) counts[way.kind] += 1;
  return counts;
}
