// Single source of truth for waypoint field caps + validation, shared by the
// API (routes/waypoints.ts) and the mobile client (outbox validation before
// enqueue). Mirrors canyonValidation.ts's payload-validator shape.

import {
  isValidLatitude,
  isValidLongitude,
  LATITUDE_RANGE,
  LONGITUDE_RANGE,
} from "./canyonValidation.js";

export const WAYPOINT_NAME_MAX_LENGTH = 120;
export const WAYPOINT_NOTES_MAX_LENGTH = 10_000;
export const WAYPOINT_SYMBOL_MAX_LENGTH = 64;

export type WaypointFieldPayload = {
  name?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  elevation?: unknown;
  symbol?: unknown;
  notes?: unknown;
};

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
  const { name, latitude, longitude, elevation, symbol, notes } = payload;

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

  return null;
}
