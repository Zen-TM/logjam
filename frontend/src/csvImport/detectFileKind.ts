// Decides whether a dropped file looks like a canyon list or a logbook (trip
// logs), per plan §7a. Pure heuristic over the parsed headers (and, for the
// disambiguating cases, a peek at the rows). The user can override the result.
//
// Rules:
//   - latitude + longitude columns present  → "canyon"
//   - a date column AND a name column, no coords → "triplog"
//   - otherwise → "unknown"
//
// Privacy: only column *names* are inspected here, never row values, so no
// canyon name/coord ever flows through this function.

import { normalize as normalizeHeader } from "./canyonColumns";

export type FileKind = "canyon" | "triplog" | "unknown";

const LATITUDE_ALIASES = new Set([
  "lat",
  "latitude",
  "y",
  "lat dd",
  "latitude dd",
]);
const LONGITUDE_ALIASES = new Set([
  "lng",
  "lon",
  "long",
  "longitude",
  "x",
  "lon dd",
  "lng dd",
  "longitude dd",
]);
const NAME_ALIASES = new Set([
  "name",
  "canyon",
  "canyon name",
  "location",
  "place",
  "site",
]);
const DATE_ALIASES = new Set([
  "date",
  "trip date",
  "visited",
  "when",
  "visit date",
  "trip",
]);

function hasAny(headers: string[], aliases: Set<string>): boolean {
  return headers.some((header) => aliases.has(normalizeHeader(header)));
}

export function detectFileKind(headers: string[]): FileKind {
  const hasLatitude = hasAny(headers, LATITUDE_ALIASES);
  const hasLongitude = hasAny(headers, LONGITUDE_ALIASES);
  const hasName = hasAny(headers, NAME_ALIASES);
  const hasDate = hasAny(headers, DATE_ALIASES);

  if (hasLatitude && hasLongitude) return "canyon";
  if (hasDate && hasName) return "triplog";
  return "unknown";
}
