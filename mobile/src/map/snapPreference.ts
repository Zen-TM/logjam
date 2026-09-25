// What the measure and route-draw tools snap new segments to.
//
// DEVICE-scoped like the other map tool preferences: it describes how this
// handset's tools behave, and it is cheap to set again on another phone.
//
// Defaults to OFF. Snapping changes what a tap does — a tap that lands
// somewhere other than where you pressed is alarming if you didn't ask for it,
// so it is opt-in.
import { readPref, writePref } from "../prefsDb";

import type { SnapMode } from "@logjam/shared";

const SNAP_PREF_KEY = "mapSnapMode";

const VALID: SnapMode[] = ["off", "trails", "waterways", "both"];

/** Synchronous, so the tool is armed correctly on its first frame. */
export function readSnapMode(): SnapMode {
  const stored = readPref(SNAP_PREF_KEY);
  return VALID.includes(stored as SnapMode) ? (stored as SnapMode) : "off";
}

/** False when the device refused to store it, so the caller can say so. */
export function writeSnapMode(mode: SnapMode): boolean {
  return writePref(SNAP_PREF_KEY, mode);
}
