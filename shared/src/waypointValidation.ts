// Single source of truth for waypoint field caps + validation, shared by the
// API (routes/waypoints.ts) and the mobile client (outbox validation before
// enqueue). Mirrors placeValidation.ts's payload-validator shape.

import {
  isValidLatitude,
  isValidLongitude,
  LATITUDE_RANGE,
  LONGITUDE_RANGE,
} from "./placeValidation.js";

export const WAYPOINT_NAME_MAX_LENGTH = 120;
export const WAYPOINT_NOTES_MAX_LENGTH = 10_000;
export const WAYPOINT_SYMBOL_MAX_LENGTH = 64;
export const WAYPOINT_TAG_MAX_LENGTH = 40;
export const MAX_TAGS_PER_WAYPOINT = 12;
export const MAX_PLACES_PER_WAYPOINT = 20;

/**
 * Built-in tag suggestions. Exactly the TRIP_TYPE_SUGGESTIONS contract: the UI
 * unions these with the distinct tags already on the user's own waypoints, and
 * free text is always allowed. A seed vocabulary, not an enum — there is no tag
 * registry to create, rename or delete.
 */
export const WAYPOINT_TAG_SUGGESTIONS = [
  "abseil",
  "campsite",
  "carpark",
  "exit",
] as const;

export type WaypointFieldPayload = {
  name?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  elevation?: unknown;
  symbol?: unknown;
  notes?: unknown;
  tags?: unknown;
  placeIds?: unknown;
};

/**
 * Normalize a free-text tag list: trimmed, nonempty, deduped
 * case-insensitively, order preserved, capped. Mirrors parseTripTypes in the
 * API, but pure and shared — the mobile outbox validates before enqueue, and a
 * queued op that the server would reject is a sync issue the user has to
 * resolve by hand, offline, in a gorge.
 *
 * undefined → undefined (PATCH: leave unchanged); null → [] (clears).
 */
export function normalizeWaypointTags(
  value: unknown,
): { tags: string[] | undefined } | { error: string } {
  if (value === undefined) return { tags: undefined };
  if (value === null) return { tags: [] };
  if (!Array.isArray(value)) {
    return { error: "tags must be an array of strings or null" };
  }

  const tags: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") {
      return { error: "tags must be an array of strings" };
    }
    const trimmed = item.trim();
    if (trimmed.length === 0) return { error: "tags entries must not be empty" };
    if (trimmed.length > WAYPOINT_TAG_MAX_LENGTH) {
      return {
        error: `tags entries must be at most ${WAYPOINT_TAG_MAX_LENGTH} characters`,
      };
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      return { error: "tags contains case-insensitive duplicates" };
    }
    seen.add(key);
    tags.push(trimmed);
  }
  if (tags.length > MAX_TAGS_PER_WAYPOINT) {
    return { error: `At most ${MAX_TAGS_PER_WAYPOINT} tags per waypoint` };
  }
  return { tags };
}

/**
 * Shape-check a placeIds list. Only the SHAPE — whether the caller may link to
 * those places is an owner-scoped lookup that belongs on the server (see
 * resolveWaypointPlaceIds), and the answer is deliberately indistinguishable
 * from "no such place" so the endpoint is not an existence oracle.
 *
 * undefined → undefined (leave unchanged); null → [] (unlinks everything).
 */
export function normalizeWaypointPlaceIds(
  value: unknown,
): { placeIds: string[] | undefined } | { error: string } {
  if (value === undefined) return { placeIds: undefined };
  if (value === null) return { placeIds: [] };
  if (!Array.isArray(value)) {
    return { error: "placeIds must be an array of strings or null" };
  }
  const placeIds: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      return { error: "placeIds must be an array of strings" };
    }
    if (!placeIds.includes(item)) placeIds.push(item);
  }
  if (placeIds.length > MAX_PLACES_PER_WAYPOINT) {
    return {
      error: `At most ${MAX_PLACES_PER_WAYPOINT} places per waypoint`,
    };
  }
  return { placeIds };
}

/**
 * Validate the fields of a waypoint create/update payload. Returns the first
 * user-facing error string, or null when everything is valid.
 *
 * - `requireCore: true` (create) demands name, latitude AND longitude.
 * - `requireCore: false` (patch) validates fields only when supplied.
 * `elevation`, `symbol`, `notes` are optional either way; explicit null clears
 * them and is always accepted.
 */
export function validateWaypointPayload(
  payload: WaypointFieldPayload,
  opts: { requireCore: boolean },
): string | null {
  const { name, latitude, longitude, elevation, symbol, notes, tags, placeIds } =
    payload;

  if (opts.requireCore || name !== undefined) {
    if (typeof name !== "string" || name.trim().length === 0) {
      return "name is required";
    }
    if (name.trim().length > WAYPOINT_NAME_MAX_LENGTH) {
      return `name must be at most ${WAYPOINT_NAME_MAX_LENGTH} characters`;
    }
  }
  if (opts.requireCore || latitude !== undefined) {
    if (!isValidLatitude(latitude)) {
      return `Latitude must be a number between ${LATITUDE_RANGE.min} and ${LATITUDE_RANGE.max}`;
    }
  }
  if (opts.requireCore || longitude !== undefined) {
    if (!isValidLongitude(longitude)) {
      return `Longitude must be a number between ${LONGITUDE_RANGE.min} and ${LONGITUDE_RANGE.max}`;
    }
  }

  if (elevation !== undefined && elevation !== null) {
    if (typeof elevation !== "number" || !Number.isFinite(elevation)) {
      return "elevation must be a number";
    }
  }
  if (symbol !== undefined && symbol !== null) {
    if (typeof symbol !== "string") return "symbol must be a string";
    if (symbol.length > WAYPOINT_SYMBOL_MAX_LENGTH) {
      return `symbol must be at most ${WAYPOINT_SYMBOL_MAX_LENGTH} characters`;
    }
  }
  if (notes !== undefined && notes !== null) {
    if (typeof notes !== "string") return "notes must be a string";
    if (notes.length > WAYPOINT_NOTES_MAX_LENGTH) {
      return `notes must be at most ${WAYPOINT_NOTES_MAX_LENGTH} characters`;
    }
  }

  const normalizedTags = normalizeWaypointTags(tags);
  if ("error" in normalizedTags) return normalizedTags.error;
  const normalizedPlaceIds = normalizeWaypointPlaceIds(placeIds);
  if ("error" in normalizedPlaceIds) return normalizedPlaceIds.error;

  return null;
}
