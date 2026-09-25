export type PlaceFieldRole =
  | "name"
  | "latitude"
  | "longitude"
  | "altNames"
  | "notes"
  | "numAbseils"
  | "longestAbseil"
  | "hours"
  | "vGrade"
  | "aGrade"
  | "commitment"
  | "quality"
  | "sources"
  | `attr:${string}`
  | "new-attr"
  | "discard";

// Integer grades with valid ranges
export const GRADE_RANGES: Partial<Record<PlaceFieldRole, [number, number]>> = {
  vGrade: [1, 7],
  aGrade: [1, 7],
  commitment: [1, 6],
  quality: [1, 5],
  numAbseils: [0, 999],
};

// Roles that map to integer fields on Place
export const INT_ROLES = new Set<PlaceFieldRole>(["vGrade", "aGrade", "commitment", "numAbseils"]);

// Roles that map to float fields (quality is a decimal 1-5)
export const FLOAT_ROLES = new Set<PlaceFieldRole>(["latitude", "longitude", "longestAbseil", "hours", "quality"]);

const ROLE_ALIASES: Record<string, PlaceFieldRole> = {};

function registerAliases(role: PlaceFieldRole, aliases: string[]) {
  for (const a of aliases) {
    ROLE_ALIASES[normalize(a)] = role;
  }
}

// Exported so detectFileKind.ts (kind detection, run before column-role
// assignment) shares this exact normalization instead of keeping its own
// hand-copied version — the two drifted once already when camelCase splitting
// was added here for IMPORT-4 and detectFileKind's copy never got it
// (FECO-004): a `latDD`/`lonDD` file failed kind detection with no override.
export function normalize(s: string): string {
  // Split camelCase / letter-digit runs before lowercasing so the app's own
  // template headers (altNames, numAbseils, longestAbseil, vGrade…) collapse to
  // the same spaced tokens as the human-readable aliases below (IMPORT-4).
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[\s_-]+/g, " ")
    .trim();
}

registerAliases("name", ["name", "place", "place name", "location", "place", "site"]);
registerAliases("latitude", ["lat", "latitude", "y", "lat_dd", "latitude_dd"]);
registerAliases("longitude", ["lng", "lon", "long", "longitude", "x", "lon_dd", "lng_dd", "longitude_dd"]);
registerAliases("altNames", ["alt names", "alt name", "alternative names", "alternative name", "aka", "aliases", "other names"]);
registerAliases("notes", ["notes", "comments", "comment", "description", "note", "details", "remarks", "info"]);
registerAliases("numAbseils", ["raps", "abseils", "pitches", "num abseils", "number abseils", "num raps", "number of pitches", "number of abseils"]);
registerAliases("longestAbseil", ["longest rap", "longest abseil", "longest pitch", "max rap", "max abseil", "longest abseil m", "longest rap m"]);
registerAliases("hours", ["time", "duration", "hours", "trip time", "trip duration", "time hrs", "hours hrs"]);
registerAliases("vGrade", ["v grade", "v", "vgrade", "vertical grade", "v_grade"]);
registerAliases("aGrade", ["a grade", "a", "agrade", "aquatic grade", "a_grade", "water grade"]);
registerAliases("commitment", ["commitment", "commit"]);
registerAliases("quality", ["quality", "stars", "rating", "qual"]);
registerAliases("sources", ["sources", "source", "refs", "references", "links", "urls"]);

// An `attr:<key>` header is the convention the CSV exporter emits for a
// place's custom-attribute values. Recognising it here lets an exported file
// re-import its custom fields with no manual mapping. The key after the prefix
// is preserved verbatim (case included) because it IS the attribute storage
// key — buildPlaceInput does `attrs[role.slice(5)] = value`. Deliberately
// strict (literal `attr:` prefix) so an ordinary column like "attribute" or
// "attributes" is NOT swept up.
function parseAttrHeader(header: string): string | null {
  const match = header.match(/^attr:(.+)$/i);
  if (!match) return null;
  const key = match[1].trim();
  return key.length > 0 ? key : null;
}

export function detectPlaceColumns(
  headers: string[],
  /**
   * The definitions in force for the type the import lands in. A header that
   * matches one by LABEL or by KEY becomes that field's column — which is what
   * makes a generated per-type template round-trip: its headers ARE the labels.
   *
   * Defaulted to none so the structural aliases still work for a caller that
   * has not chosen a type yet.
   */
  defs: { key: string; label: string }[] = [],
): Record<string, PlaceFieldRole> {
  const byNormalised = new Map<string, string>();
  for (const def of defs) {
    byNormalised.set(normalize(def.label), def.key);
    byNormalised.set(normalize(def.key), def.key);
  }
  const result: Record<string, PlaceFieldRole> = {};
  for (const header of headers) {
    const attrKey = parseAttrHeader(header);
    if (attrKey) {
      result[header] = `attr:${attrKey}`;
      continue;
    }
    const n = normalize(header);
    // A STRUCTURAL alias wins over a definition's label: a user who names a
    // field "Notes" has not renamed the place's own notes column, and mapping
    // their field over it would silently redirect every note in the file.
    const alias = ROLE_ALIASES[n];
    if (alias) {
      result[header] = alias;
      continue;
    }
    const defKey = byNormalised.get(n);
    result[header] = defKey ? `attr:${defKey}` : "discard";
  }
  return result;
}

export const ROLE_LABELS: Record<string, string> = {
  name: "Name",
  latitude: "Latitude",
  longitude: "Longitude",
  altNames: "Alternative Names",
  notes: "Notes",
  numAbseils: "Pitches",
  longestAbseil: "Longest Pitch (m)",
  hours: "Hours",
  vGrade: "V Grade",
  aGrade: "A Grade",
  commitment: "Commitment",
  quality: "Quality",
  sources: "Sources",
  "new-attr": "New custom attribute",
  discard: "Discard column",
};

/** STRUCTURAL roles — the ones every place has, whatever its type. */
export const STRUCTURAL_ROLES: PlaceFieldRole[] = [
  "name", "latitude", "longitude", "altNames", "notes",
];

/** The seven CANYON roles, which have bespoke parsing and ranges (a v-grade is
 *  1-7, a quality is a decimal 1-5). They are the Canyon type's system field
 *  definitions; a campsite import must not be offered them. */
export const CANYON_ROLES: PlaceFieldRole[] = [
  "numAbseils", "longestAbseil", "hours",
  "vGrade", "aGrade", "commitment", "quality",
];

export const ALL_ASSIGNABLE_ROLES: PlaceFieldRole[] = [
  ...STRUCTURAL_ROLES,
  ...CANYON_ROLES,
  "sources", "new-attr", "discard",
];

/**
 * The roles offered for a place list landing in one TYPE.
 *
 * Structural columns are a fixed table — a name is a name whatever the place
 * is. Type-specific columns are the definitions in force for the chosen type,
 * offered as `attr:<key>` so the value lands in the field it belongs to. The
 * canyon seven keep their bespoke roles because they parse and range-check
 * differently (v3, a4, III), and they appear only when the type is Canyon.
 */
export function assignableRolesForType(
  isCanyonType: boolean,
  defs: { key: string }[],
): PlaceFieldRole[] {
  return [
    ...STRUCTURAL_ROLES,
    ...(isCanyonType ? CANYON_ROLES : []),
    ...defs
      .map((def) => `attr:${def.key}` as PlaceFieldRole)
      // The canyon seven ARE definitions of the Canyon type; offering them
      // twice — once bespoke, once generic — would let a user map two columns
      // onto one key with different parsers.
      .filter((role) => !isCanyonType || !RESERVED_ATTR_ROLES.has(role)),
    "sources",
    "new-attr",
    "discard",
  ];
}

/** `attr:` roles that duplicate a bespoke canyon role above. */
const RESERVED_ATTR_ROLES = new Set<string>([
  "attr:v_grade",
  "attr:a_grade",
  "attr:commitment",
  "attr:quality",
  "attr:hours",
  "attr:num_abseils",
  "attr:longest_abseil",
]);

export const REQUIRED_ROLES: PlaceFieldRole[] = ["name", "latitude", "longitude"];
