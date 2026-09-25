// Trip title derivation — same contract as web tripTitle() in
// frontend/src/placeUtils.ts (root CLAUDE.md convention: displayName ??
// formatTripPlaceNames(linked names) ?? "Untitled trip"; never inline the
// join, never store a derived title).
import { formatTripPlaceNames } from "@logjam/shared";

import type { TTripLog } from "./types";

export function tripTitle(trip: TTripLog): string {
  return (
    trip.displayName ??
    formatTripPlaceNames(trip.places.map((c) => c.name)) ??
    "Untitled trip"
  );
}
