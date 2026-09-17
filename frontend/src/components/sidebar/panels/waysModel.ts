// The Ways page's decisions, kept out of the component so they can be tested:
// what a "way" is, which kinds exist, and how four sources become one list.
//
// Ways answers "what lines have I got?" — routes I drew, tracks I recorded,
// files I imported (DESIGN.md §1). Logjam GPS answers the same question on its
// Saved tab, and its vocabulary is the one used here: `CATEGORY_META` in
// `mobile/src/saved/savedKeys.ts` names them Routes, Tracks and Imports.
//
// A fourth kind exists here and NOT on the phone, for a reason worth stating: a
// track file attached to a place is that place's way, so on a handset it lives
// on the place. In a browser the page still has to list it, because
// `GET /places/tracks` is the only surface that shows tracks on places a FRIEND
// shared — those are not the user's own files and appear nowhere else. That
// endpoint also returns nothing but a place id, a media id and a colour, so a
// row built from it cannot be sorted into the three kinds above (it has neither
// a filename nor an `origin`); it is named for its place instead, which is what
// the old panel did for the same reason.
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
export const WAY_KINDS = ["route", "track", "import", "place"] as const;

export type WayKind = (typeof WAY_KINDS)[number];

/**
 * The rail's words. Plural, because a chip labels a group.
 *
 * "On a place" rather than a noun: the other three name what a thing IS, and
 * this one names where it lives — the distinguishing fact about a file that
 * belongs to a place is the place, not the file.
 */
export const WAY_KIND_LABELS: Record<WayKind, string> = {
  route: "Routes",
  track: "Tracks",
  import: "Imports",
  place: "On a place",
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
  /** The place this way belongs to, where it belongs to one. */
  placeId: string | null;
};

/**
 * Every way the user can see, as one list.
 *
 * De-duplicated by media id: the user's OWN file linked to their own place is
 * returned by both `/media/standalone` (carrying its name and origin) and
 * `/places/tracks` (carrying neither), and listing it twice is what the two
 * endpoints' overlap would otherwise produce. The richer row wins, so the one
 * that survives is the one that knows what the file is called.
 */
export function buildWays({
  routes,
  standaloneFiles,
  placeTracks,
  currentUserId,
  placeName,
}: {
  routes: readonly TRoute[];
  standaloneFiles: readonly StandaloneFile[];
  placeTracks: readonly PlaceTrack[];
  currentUserId: string | null;
  /** A place's name, for the rows that are named after their place. */
  placeName: (placeId: string) => string;
}): WayItem[] {
  const fileIds = new Set(standaloneFiles.map((file) => file.id));
  return [
    ...routes.map(
      (route): WayItem => ({
        key: `route-${route.id}`,
        kind: "route",
        id: route.id,
        title: route.name,
        distanceM: routeLengthM(route.points),
        color: route.color,
        shared: currentUserId !== null && route.ownerId !== currentUserId,
        placeId: route.placeId,
      }),
    ),
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
        placeId: file.linkedPlaceId,
      }),
    ),
    ...placeTracks
      .filter((track) => !fileIds.has(track.mediaId))
      .map(
        (track): WayItem => ({
          key: `place-track-${track.mediaId}`,
          kind: "place",
          // The MEDIA id is the thing's identity; the row is titled by its
          // place because that is all this endpoint knows about it.
          id: track.mediaId,
          title: placeName(track.placeId),
          distanceM: null,
          color: track.color,
          // Everything left after the de-duplication above is a track on a
          // place the user does not own — their own are standalone files.
          shared: true,
          placeId: track.placeId,
        }),
      ),
  ];
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
  const counts = { all: ways.length, route: 0, track: 0, import: 0, place: 0 };
  for (const way of ways) counts[way.kind] += 1;
  return counts;
}
