import type { MediaMetadata, MediaOrigin } from "./mediaMetadata.js";

// Media (object storage) shared types + validation.
//
// A media row is ONE uploaded file belonging to one account. It may hang off a
// Canyon or a TripLog, or off nothing at all — a `"none"` row is the user's own
// standalone file (an import they brought in, a track they recorded), which is
// what lets those sync at all. Each image/video stores two S3 objects — a
// full-res "display" copy and a client-generated "thumbnail"; track files
// (GPX/KML/GeoJSON) store the display copy only. The category drives both
// server-side validation and client-side rendering (image → <img>,
// video → <video>, track → line on the map + download).
//
// A standalone file becomes a canyon's way by having its PARENT set, never by
// being copied (api/src/routes/media.ts, PATCH /:id/link). Linking and
// unlinking are therefore visibility changes on one file, and unlinking a
// shared canyon's way must tombstone it for that canyon's sharees.

export type MediaLinkedType = "canyon" | "tripLog" | "none";
export type MediaCategory = "image" | "video" | "track";

export const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const VIDEO_MIME_TYPES = ["video/mp4", "video/quicktime", "video/webm"] as const;
export const TRACK_MIME_TYPES = [
  "application/gpx+xml",
  "application/vnd.google-earth.kml+xml",
  "application/geo+json",
] as const;

// Per-category upload size caps, enforced authoritatively server-side against
// the real S3 object size (never the client's declared size).
export const MEDIA_SIZE_CAPS: Record<MediaCategory, number> = {
  image: 30 * 1024 * 1024, // 30 MB
  video: 500 * 1024 * 1024, // 500 MB
  track: 20 * 1024 * 1024, // 20 MB
};

// Canonical file extension per accepted MIME type. S3 keys are derived from the
// MIME type (not the client filename) so the stored key is always predictable.
export const MEDIA_EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "application/gpx+xml": "gpx",
  "application/vnd.google-earth.kml+xml": "kml",
  "application/geo+json": "geojson",
};

// Palette assigned to canyon/trip-log tracks at upload time and reused for the
// track card icon and the map track layer. Hand-picked to be perceptually
// distinct and legible on the map, avoiding the canyon-marker colours
// (#f97316 owned, #629bf8 shared) and the topo layer tints.
export const TRACK_COLORS = [
  "#e6194b", // red
  "#3cb44b", // green
  "#ffe119", // yellow
  "#911eb4", // purple
  "#42d4f4", // cyan
  "#f032e6", // magenta
  "#bfef45", // lime
  "#469990", // teal
  "#9a6324", // brown
  "#dcbeff", // lavender
] as const;

export type TrackColor = (typeof TRACK_COLORS)[number];

/**
 * Picks the next best track/route colour avoiding collisions with existing items.
 * 1. Returns the first unused colour from TRACK_COLORS.
 * 2. If all colours are present, returns the colour with the lowest frequency.
 */
export function pickNextTrackColor(
  existingColors: readonly (string | null | undefined)[] | (string | null | undefined)[],
): string {
  const counts = new Map<string, number>();
  for (const c of TRACK_COLORS) counts.set(c, 0);

  for (const c of existingColors) {
    if (c && counts.has(c)) {
      counts.set(c, counts.get(c)! + 1);
    }
  }

  let minCount = Infinity;
  let bestColor: string = TRACK_COLORS[0];

  for (const c of TRACK_COLORS) {
    const count = counts.get(c)!;
    if (count < minCount) {
      minCount = count;
      bestColor = c;
      if (minCount === 0) break; // Found an unused colour
    }
  }

  return bestColor;
}

/**
 * Picks a deterministic palette colour given an item index (e.g. for batch imports).
 */
export function pickTrackColorByIndex(index: number): string {
  const normalized = Math.max(0, Math.floor(index));
  return TRACK_COLORS[normalized % TRACK_COLORS.length];
}

/**
 * @deprecated Use `pickNextTrackColor` or `pickTrackColorByIndex`.
 * Retained for backwards compatibility.
 */
export function randomTrackColor(): string {
  return pickNextTrackColor([]);
}

export function mediaCategory(mimeType: string): MediaCategory | null {
  if ((IMAGE_MIME_TYPES as readonly string[]).includes(mimeType)) return "image";
  if ((VIDEO_MIME_TYPES as readonly string[]).includes(mimeType)) return "video";
  if ((TRACK_MIME_TYPES as readonly string[]).includes(mimeType)) return "track";
  return null;
}

// Only image and video carry a thumbnail; tracks do not.
export function categoryHasThumbnail(category: MediaCategory): boolean {
  return category === "image" || category === "video";
}

// One media item as returned to the client. `displayUrl`/`thumbnailUrl` are
// short-lived presigned S3 GET URLs minted per request — never persisted.
export interface MediaItem {
  id: string;
  linkedType: MediaLinkedType;
  /** Null exactly when `linkedType` is `"none"` — a standalone file. */
  linkedId: string | null;
  mediaType: string; // MIME type
  filename: string;
  fileSizeBytes: number;
  createdAt: string;
  /** Bumped by a link/unlink; the delta pull keysets on it. */
  updatedAt: string;
  displayUrl: string;
  thumbnailUrl: string | null;
  // Assigned only for track (GPX/KML/GeoJSON) media; null for image/video.
  // Drives the track card icon tint and the map track layer colour.
  color: string | null;
  /** How a standalone file came to exist; null for canyon/trip attachments. */
  origin: MediaOrigin | null;
  /** User-facing label; null falls back to `filename`. See mediaDisplayName. */
  displayName: string | null;
  /** Row-level stats — see shared/src/mediaMetadata.ts. `{}` when origin is null. */
  metadata: MediaMetadata;
}

/**
 * What to CALL a file in the UI.
 *
 * One derivation, in the shape the trip-title rule already takes: the user's
 * own label if there is one, else the file's name. Never store the result —
 * `displayName` stays null until something sets it, so a fallback that got
 * persisted would freeze a name the user never chose.
 */
export function mediaDisplayName(media: {
  displayName?: string | null;
  filename?: string | null;
}): string {
  const label = media.displayName?.trim();
  if (label) return label;
  return media.filename?.trim() || "Untitled file";
}

/** Cap for a user-supplied media label, matching the trip-title cap. */
export const MEDIA_DISPLAY_NAME_MAX = 200;

/**
 * A standalone file as listed for a client that is NOT delta-synced (the web
 * app). Metadata only — no presigned URLs.
 *
 * Deliberately without them: minting a URL per row would put the whole list
 * through the egress meter every time the page loaded, whether or not anything
 * was opened. Content comes from POST /media/download-urls, which is where the
 * gate lives.
 */
export interface StandaloneFile {
  id: string;
  mediaType: string;
  filename: string;
  displayName: string | null;
  fileSizeBytes: number;
  color: string | null;
  origin: MediaOrigin;
  metadata: MediaMetadata;
  /** The canyon it is linked to as that canyon's way, or null. */
  linkedCanyonId: string | null;
  createdAt: string;
  updatedAt: string;
}
