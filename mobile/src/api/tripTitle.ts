// Trip title derivation — same contract as web tripTitle() in
// frontend/src/canyonUtils.ts (root CLAUDE.md convention: displayName ??
// formatTripCanyonNames(linked names) ?? "Untitled trip"; never inline the
// join, never store a derived title).
import { formatTripCanyonNames } from "@logjam/shared";

import type { TTripLog } from "./types";

export function tripTitle(trip: TTripLog): string {
  return (
    trip.displayName ??
    formatTripCanyonNames(trip.canyons.map((c) => c.name)) ??
    "Untitled trip"
  );
}
