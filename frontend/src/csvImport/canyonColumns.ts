export type CanyonFieldRole =
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
export const GRADE_RANGES: Partial<Record<CanyonFieldRole, [number, number]>> = {
  vGrade: [1, 7],
  aGrade: [1, 7],
  commitment: [1, 6],
  quality: [1, 5],
  numAbseils: [0, 999],
};

// Roles that map to integer fields on Canyon
export const INT_ROLES = new Set<CanyonFieldRole>(["vGrade", "aGrade", "commitment", "numAbseils"]);

// Roles that map to float fields (quality is a decimal 1-5)
export const FLOAT_ROLES = new Set<CanyonFieldRole>(["latitude", "longitude", "longestAbseil", "hours", "quality"]);

const ROLE_ALIASES: Record<string, CanyonFieldRole> = {};

function registerAliases(role: CanyonFieldRole, aliases: string[]) {
  for (const a of aliases) {
    ROLE_ALIASES[normalize(a)] = role;
  }
}

function normalize(s: string): string {
  // Split camelCase / letter-digit runs before lowercasing so the app's own
  // template headers (altNames, numAbseils, longestAbseil, vGrade…) collapse to
  // the same spaced tokens as the human-readable aliases below (IMPORT-4).
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[\s_-]+/g, " ")
    .trim();
}

registerAliases("name", ["name", "canyon", "canyon name", "location", "place", "site"]);
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

export function detectCanyonColumns(
  headers: string[],
): Record<string, CanyonFieldRole> {
  const result: Record<string, CanyonFieldRole> = {};
  for (const header of headers) {
    const n = normalize(header);
    result[header] = ROLE_ALIASES[n] ?? "discard";
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

export const ALL_ASSIGNABLE_ROLES: CanyonFieldRole[] = [
  "name", "latitude", "longitude", "altNames", "notes",
  "numAbseils", "longestAbseil", "hours",
  "vGrade", "aGrade", "commitment", "quality",
  "sources", "new-attr", "discard",
];

export const REQUIRED_ROLES: CanyonFieldRole[] = ["name", "latitude", "longitude"];
