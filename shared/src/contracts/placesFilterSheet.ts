// Places → Sort and filter: the sheet behind the list's filter button, on
// Logjam Web (`PlaceFilterSheet.tsx`) and Logjam GPS (`places/PlaceFilterSheet.tsx`).
//
// Visited, not visited and shared are NOT sections: they are the list's status
// rail, and a second copy here could disagree with it.
import type { TripLogCustomFieldDef } from "../tripLogFields.js";
import { filterPillStops } from "../placeFilterOptions.js";
import { regionEdgesKm } from "../mapRegionEstimate.js";
import type { RegionBbox } from "../mapRegionEstimate.js";
import type { ScreenContract } from "./types.js";

export const PLACES_FILTER_SHEET = {
  id: "places.filterSheet",
  title: "Sort and filter",
  sections: [
    // The options are `PLACE_SORT_OPTIONS`.
    { key: "sort" },
    // One row per definition in force for the type rail's selection, each
    // drawn by `attributeFilterShape`, never by its key: a canyon's grades are
    // ordinary attributes. The include-missing switch closes the section,
    // because attributes are the only thing it widens.
    { key: "attributes" },
    { key: "location" },
    // The options are `PLACE_ROPEWIKI_OPTIONS`, then the shared-by-me switch.
    { key: "source" },
    { key: "dates" },
    {
      key: "onMap",
      on: "gps",
      reason:
        "Logjam Web's list sits beside its map, which always draws what the list shows. On Logjam GPS the map is another tab, so narrowing it is a choice the user makes here and can see.",
    },
  ],
  copy: {
    // A section's title is the copy under its own key.
    sort: "Sort",
    attributes: "Attributes",
    location: "Location",
    source: "Source",
    dates: "Dates",
    onMap: "On the map",

    includeMissing: "Include places missing this info",
    drawArea: "Draw on map",
    /** Logjam Web only: the map is in view beside the sheet. */
    areaToView: "This view",
    clear: "Clear",
    sharedByMe: "Shared by me",
    added: "Added",
    updated: "Updated",
    dateFrom: "From",
    dateTo: "To",
    showOnMap: "Show filtered places on the map",
    reset: "Reset",
    done: "Done",
  },
} as const satisfies ScreenContract;

/**
 * The control an attribute's filter row is, decided by the definition's SHAPE
 * so both clients draw a user's "Difficulty, 1-5" exactly as a V grade:
 * pills for a small whole-number axis, from–to boxes for any other bounded
 * number, operator and value for an unbounded one.
 */
export type AttributeFilterShape =
  | "pills"
  | "minMax"
  | "threshold"
  | "boolean"
  | "text"
  | "date";

export function attributeFilterShape(
  def: Pick<TripLogCustomFieldDef, "type" | "min" | "max">,
): AttributeFilterShape {
  switch (def.type) {
    case "integer":
    case "float":
      if (filterPillStops(def)) return "pills";
      return def.min != null && def.max != null ? "minMax" : "threshold";
    case "boolean":
      return "boolean";
    case "string":
      return "text";
    case "date":
      return "date";
  }
}

/**
 * A drawn area as its SIZE, never its position: "18 × 11 km" tells two areas
 * apart without putting a coordinate in text on a screen.
 */
export function areaSizeLabel(area: RegionBbox): string {
  const [width, height] = regionEdgesKm(area);
  return `${Math.round(width)} × ${Math.round(height)} km`;
}

/** What the map is showing, under the on-the-map switch. */
export function placesOnMapSummary(
  enabled: boolean,
  filteredCount: number,
  totalCount: number,
): string {
  if (!enabled) return "The map shows every place";
  // Nothing is being narrowed: say so rather than print a fraction that reads
  // as "one place is missing".
  return filteredCount >= totalCount
    ? `All ${totalCount} places`
    : `${filteredCount} of ${totalCount} places`;
}
