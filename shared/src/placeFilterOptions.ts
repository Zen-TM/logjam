// The words and presets of the place filter sheet, shared by Logjam GPS and
// Logjam Web so the two sheets offer the same sorts, the same RopeWiki choices
// and the same logistics shortcuts under the same names.
import type { PlaceFilters, PlaceSortKey, PlaceThresholdFilter } from "./placeFilter.js";
import type { TripLogCustomFieldDef } from "./tripLogFields.js";

/** The widest span still drawn as pills; a wider axis gets two number boxes. */
export const MAX_FILTER_PILL_SPAN = 12;

/**
 * The numbered pills a place filter draws for a field, or null when the field
 * is not pill-shaped. Decided by the definition's SHAPE — bounded, whole-number
 * bounds, a small span — never by its key, so a canyon's V grade, a campsite's
 * quality and a user's own "Difficulty, 1-5" get the same control and nothing
 * needs to know which type a field came from.
 *
 * A float qualifies, unlike the phone's form rail (`railStops`): a form must be
 * able to WRITE 4.5, while a filter asks for a range, and 4-5 holds a 4.5.
 */
export function filterPillStops(def: Pick<TripLogCustomFieldDef, "type" | "min" | "max">): number[] | null {
  if (def.type !== "integer" && def.type !== "float") return null;
  if (def.min == null || def.max == null) return null;
  if (!Number.isInteger(def.min) || !Number.isInteger(def.max)) return null;
  const span = def.max - def.min;
  if (span < 1 || span > MAX_FILTER_PILL_SPAN) return null;
  const stops: number[] = [];
  for (let stop = def.min; stop <= def.max; stop += 1) stops.push(stop);
  return stops;
}

export const PLACE_SORT_OPTIONS: { key: PlaceSortKey; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "recent", label: "Recently added" },
  { key: "grade", label: "Easiest first" },
  { key: "quality", label: "Best rated" },
];

export function placeSortLabel(sort: PlaceSortKey): string {
  return PLACE_SORT_OPTIONS.find((option) => option.key === sort)?.label ?? "Name";
}

export const PLACE_ROPEWIKI_OPTIONS: { value: PlaceFilters["ropewiki"]; label: string }[] = [
  { value: "any", label: "Any" },
  { value: "linked", label: "From RopeWiki" },
  { value: "unlinked", label: "Not from RopeWiki" },
];

/**
 * The canyon logistics axes, each with the presets someone chose because they
 * are the numbers that decide a day. A field the user invented gets no presets:
 * deriving them from its bounds gave "Under 0 / Over 0 / Exactly 0".
 */
export const PLACE_THRESHOLDS: {
  key: string;
  label: string;
  unit: string;
  presets: PlaceThresholdFilter[];
}[] = [
  {
    key: "num_abseils",
    label: "Abseils",
    unit: "",
    presets: [
      ["Exactly", 0],
      ["Less than", 5],
      ["More than", 10],
    ],
  },
  {
    key: "longest_abseil",
    label: "Longest abseil",
    unit: "m",
    presets: [
      ["Less than", 20],
      ["Less than", 30],
      ["Less than", 45],
      ["Less than", 60],
    ],
  },
  {
    key: "hours",
    label: "Time out",
    unit: "h",
    presets: [
      ["Less than", 4],
      ["Less than", 6],
      ["Less than", 8],
    ],
  },
];

export const THRESHOLD_OPERATORS: PlaceThresholdFilter[0][] = ["Less than", "More than", "Exactly"];

export const THRESHOLD_OPERATOR_LABELS: Record<PlaceThresholdFilter[0], string> = {
  Any: "Any",
  "Less than": "Under",
  "More than": "Over",
  Exactly: "Exactly",
};

export function formatThreshold(filter: PlaceThresholdFilter, unit: string): string {
  return `${THRESHOLD_OPERATOR_LABELS[filter[0]]} ${filter[1]}${unit ? ` ${unit}` : ""}`;
}
