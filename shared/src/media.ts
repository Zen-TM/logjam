// Media (object storage) shared types + validation.
//
// Media rows link an uploaded file (image/video/track) to either a Canyon or a
// TripLog. Each image/video stores two S3 objects — a full-res "display" copy
// and a client-generated "thumbnail"; track files (GPX/KML) store the display
// copy only. The category drives both server-side validation and client-side
// rendering (image → <img>, video → <video>, track → download link).

export type MediaLinkedType = "canyon" | "tripLog";
export type MediaCategory = "image" | "video" | "track";

export const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const VIDEO_MIME_TYPES = ["video/mp4", "video/quicktime", "video/webm"] as const;
export const TRACK_MIME_TYPES = [
  "application/gpx+xml",
  "application/vnd.google-earth.kml+xml",
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

// Pick a random colour from the canonical track palette. Assigned server-side
// when a track is confirmed so the colour is stable across the card and map.
export function randomTrackColor(): string {
  return TRACK_COLORS[Math.floor(Math.random() * TRACK_COLORS.length)];
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
  linkedId: string;
  mediaType: string; // MIME type
  filename: string;
  fileSizeBytes: number;
  createdAt: string;
  displayUrl: string;
  thumbnailUrl: string | null;
  // Assigned only for track (GPX/KML) media; null for image/video. Drives the
  // track card icon tint and the map track layer colour.
  color: string | null;
}
