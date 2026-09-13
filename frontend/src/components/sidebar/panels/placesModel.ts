// The Places panel's decisions, kept out of the component so they can be tested:
// how the status rail maps onto the filter, what the sheet's badge counts, and
// the area a "Make a map" starts from.
import {
  activePlaceFilterCount,
  EMPTY_PLACE_FILTERS,
  type PlaceFilters,
  type PlaceStatus,
  type RegionBbox,
} from "@logjam/shared";

export type StatusBucket = "all" | PlaceStatus;

/**
 * The status rail is two filter fields read together — ownership and
 * completion — because "shared" is an ownership and "visited" a completion.
 * A place you visited is always your own (a trip links only its owner's
 * places), so visited and not visited both mean owned.
 */
export function withBucket(filters: PlaceFilters, bucket: StatusBucket): PlaceFilters {
  switch (bucket) {
    case "all":
      return { ...filters, ownership: "all", completion: "any" };
    case "shared":
      return { ...filters, ownership: "shared", completion: "any" };
    case "done":
      return { ...filters, ownership: "owned", completion: "done" };
    case "todo":
      return { ...filters, ownership: "owned", completion: "not_done" };
  }
}

/**
 * Which chip the filter corresponds to. A combination the rail cannot show (an
 * ownership or completion set by an older build's accordion, still in session
 * storage) maps to its nearest chip — and `normaliseBucket` rewrites the filter
 * to match, so no hidden axis goes on narrowing the list with no chip lit.
 */
export function bucketOf(filters: PlaceFilters): StatusBucket {
  if (filters.ownership === "shared") return "shared";
  if (filters.completion === "done") return "done";
  if (filters.completion === "not_done") return "todo";
  return "all";
}

/** The filter with its status axes exactly as the rail shows them, or the same
 *  object when they already are. */
export function normaliseBucket(filters: PlaceFilters): PlaceFilters {
  const normalised = withBucket(filters, bucketOf(filters));
  return normalised.ownership === filters.ownership && normalised.completion === filters.completion
    ? filters
    : normalised;
}

/** The filters the SHEET owns — everything but the two rails (type, status). */
export function sheetFilterCount(filters: PlaceFilters): number {
  return activePlaceFilterCount({ ...filters, placeTypeId: null, ownership: "all", completion: "any" });
}

/** Clear what the sheet owns and keep what the rails show. */
export function clearSheetFilters(filters: PlaceFilters): PlaceFilters {
  return {
    ...EMPTY_PLACE_FILTERS,
    custom: {},
    placeTypeId: filters.placeTypeId,
    ownership: filters.ownership,
    completion: filters.completion,
  };
}

const KM_PER_DEGREE_LAT = 111.32;

/**
 * The area a map of these places should cover: the box around them, widened by
 * a tenth on every side so edge places are not on the paper's margin, and never
 * narrower than `minEdgeKm` so a single place gets a useful map rather than a
 * point. Null for no places.
 */
export function placesBounds(
  places: readonly { latitude: number; longitude: number }[],
  minEdgeKm = 2,
): RegionBbox | null {
  if (places.length === 0) return null;
  const lats = places.map((place) => place.latitude);
  const lngs = places.map((place) => place.longitude);
  let south = Math.min(...lats);
  let north = Math.max(...lats);
  let west = Math.min(...lngs);
  let east = Math.max(...lngs);

  const latPad = (north - south) * 0.1;
  const lngPad = (east - west) * 0.1;
  south -= latPad;
  north += latPad;
  west -= lngPad;
  east += lngPad;

  const midLat = (south + north) / 2;
  const minLatSpan = minEdgeKm / KM_PER_DEGREE_LAT;
  const minLngSpan = minEdgeKm / (KM_PER_DEGREE_LAT * Math.cos((midLat * Math.PI) / 180));
  if (north - south < minLatSpan) {
    const mid = (north + south) / 2;
    south = mid - minLatSpan / 2;
    north = mid + minLatSpan / 2;
  }
  if (east - west < minLngSpan) {
    const mid = (east + west) / 2;
    west = mid - minLngSpan / 2;
    east = mid + minLngSpan / 2;
  }
  return { west, south, east, north };
}

/** The ids from `from` to `to` inclusive, in list order — a shift-click range.
 *  Just `to` when the anchor is no longer in the list. */
export function idRange(ids: readonly string[], from: string | null, to: string): string[] {
  const end = ids.indexOf(to);
  const start = from == null ? -1 : ids.indexOf(from);
  if (end < 0) return [];
  if (start < 0) return [to];
  return ids.slice(Math.min(start, end), Math.max(start, end) + 1);
}
