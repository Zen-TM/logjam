// The stats a standalone media file carries on its ROW, so a second device can
// list it — name, size, extent, how far you walked — without downloading the
// blob (stage8-sync.md §7.3: delta rows are metadata only).
//
// Lives in a `Json` column rather than a dozen nullable ones, the same shape
// `Canyon.attributes` and `TripLog.customFields` already take. The cost of a
// Json column is that nothing enforces its shape, so this file IS the
// enforcement: the API parses every write through `parseMediaMetadata` and both
// clients read through `readMediaMetadata`. A field that is not declared here
// does not survive a round trip.
//
// PRIVACY: a bbox is coarse canyon location and rides the same delta page as
// the canyon coordinates themselves — no new exposure. It is nonetheless real
// location data: never log a parsed metadata object, and never put one in an
// error message (the parse errors below name FIELDS, never values).

/** [west, south, east, north] — the extent of an import or a recording. */
export type MediaBbox = [number, number, number, number];

/**
 * How a standalone file came to exist. Canyon/trip attachments carry `null`:
 * they are "a file on this canyon" and need no further provenance.
 *
 * The vocabulary is deliberately `FileSend.sourceKind`'s — the same two kinds
 * of file, and a send is how one of them reaches another account.
 */
export const MEDIA_ORIGINS = ["import", "track"] as const;
export type MediaOrigin = (typeof MEDIA_ORIGINS)[number];

export function isMediaOrigin(value: unknown): value is MediaOrigin {
  return (MEDIA_ORIGINS as readonly unknown[]).includes(value);
}

/** A file the user brought in from another app (GPX/KML/GeoJSON). */
export type ImportMetadata = {
  bbox: MediaBbox;
  featureCount: number;
  positionCount: number;
};

/**
 * A GPS track this account recorded. Stats are the recorder's own
 * (shared/src/trackStats.ts) rather than derived on read: they account for
 * pauses and rejected fixes, which the serialised GPX no longer knows about.
 */
export type TrackMetadata = {
  bbox: MediaBbox;
  distanceM: number;
  durationMs: number;
  elevationGainM: number;
  elevationLossM: number;
  pointCount: number;
  /** ISO 8601. */
  startedAt: string;
  /** ISO 8601. */
  endedAt: string;
};

/**
 * What a row actually carries. A union would be more precise, but `origin` is
 * the discriminant and lives on the ROW rather than inside the object, so every
 * reader would have to narrow by a sibling field anyway — and a reader that
 * only wants `bbox` should not have to care which kind it has.
 */
export type MediaMetadata = Partial<ImportMetadata & TrackMetadata>;

export class MediaMetadataError extends Error {}

function requireObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new MediaMetadataError("metadata must be an object");
  }
  return value as Record<string, unknown>;
}

function requireFiniteNumber(
  source: Record<string, unknown>,
  field: string,
): number {
  const value = source[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new MediaMetadataError(`metadata.${field} must be a finite number`);
  }
  return value;
}

function requireNonNegative(
  source: Record<string, unknown>,
  field: string,
): number {
  const value = requireFiniteNumber(source, field);
  if (value < 0) {
    throw new MediaMetadataError(`metadata.${field} must not be negative`);
  }
  return value;
}

function requireIsoTimestamp(
  source: Record<string, unknown>,
  field: string,
): string {
  const value = source[field];
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new MediaMetadataError(`metadata.${field} must be an ISO timestamp`);
  }
  return value;
}

/**
 * Bounds are validated as COORDINATES, not just numbers: a NaN or a swapped
 * pair here becomes a camera move on another device, and "show on map" jumping
 * to the null island is the kind of bug that looks like a map fault.
 *
 * West > east is accepted — that is an extent crossing the antimeridian, which
 * is legal and not something NSW will produce but also not ours to reject.
 */
function requireBbox(source: Record<string, unknown>): MediaBbox {
  const value = source.bbox;
  if (!Array.isArray(value) || value.length !== 4) {
    throw new MediaMetadataError("metadata.bbox must be [w, s, e, n]");
  }
  const [west, south, east, north] = value;
  for (const coord of [west, east]) {
    if (typeof coord !== "number" || !Number.isFinite(coord) || Math.abs(coord) > 180) {
      throw new MediaMetadataError("metadata.bbox longitudes are out of range");
    }
  }
  for (const coord of [south, north]) {
    if (typeof coord !== "number" || !Number.isFinite(coord) || Math.abs(coord) > 90) {
      throw new MediaMetadataError("metadata.bbox latitudes are out of range");
    }
  }
  if ((south as number) > (north as number)) {
    throw new MediaMetadataError("metadata.bbox south is north of north");
  }
  return [west, south, east, north] as MediaBbox;
}

/**
 * Validate metadata for a write. Throws `MediaMetadataError` (the API turns it
 * into a 400) rather than dropping bad fields — a silently-emptied stats object
 * shows up as a track with no distance and no way to tell why.
 *
 * Unknown keys are DROPPED, not rejected: the returned object is what gets
 * stored, so a newer client writing a field this version does not know about
 * loses that field rather than the whole write.
 */
export function parseMediaMetadata(
  origin: MediaOrigin | null,
  value: unknown,
): MediaMetadata {
  if (origin === null) {
    // A canyon/trip attachment has no stats. Anything sent is a client bug,
    // and storing it would make `origin` stop meaning what it says.
    return {};
  }
  const source = requireObject(value ?? {});
  if (origin === "import") {
    return {
      bbox: requireBbox(source),
      featureCount: requireNonNegative(source, "featureCount"),
      positionCount: requireNonNegative(source, "positionCount"),
    };
  }
  return {
    bbox: requireBbox(source),
    distanceM: requireNonNegative(source, "distanceM"),
    durationMs: requireNonNegative(source, "durationMs"),
    // Gain and loss are both magnitudes; a negative loss would double-count.
    elevationGainM: requireNonNegative(source, "elevationGainM"),
    elevationLossM: requireNonNegative(source, "elevationLossM"),
    pointCount: requireNonNegative(source, "pointCount"),
    startedAt: requireIsoTimestamp(source, "startedAt"),
    endedAt: requireIsoTimestamp(source, "endedAt"),
  };
}

/**
 * Read metadata off a row for DISPLAY. Never throws: a row that predates a
 * field, or one written by a client with a bug, must still render as a file
 * with a name and a size rather than taking the list down.
 */
export function readMediaMetadata(
  origin: string | null,
  value: unknown,
): MediaMetadata {
  if (!isMediaOrigin(origin)) return {};
  try {
    return parseMediaMetadata(origin, value);
  } catch {
    return {};
  }
}
