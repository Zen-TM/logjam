// The compass tape's on/off switch (Settings → This phone).
//
// DEVICE-scoped like the app lock, and for the same kind of reason: it is a
// statement about this handset (it runs the magnetometer, and a phone whose
// compass reads badly is a phone-specific problem), not an account preference
// to push to the user's other devices.
//
// Defaults to OFF (operator decision, 2026-08-17, on the battery pass). It runs
// the magnetometer AND the accelerometer for as long as the map tab is open —
// expo-location registers both at SENSOR_DELAY_NORMAL and there is no way to
// ask for less — and the tape is an instrument most trips never look at. The
// location arrow still turns it on for as long as the arrow is on screen, so
// "which way am I facing" is one locate-me tap away either way; this switch is
// only about the standing tape along the bottom edge.
import { readPref, writePref } from "../prefsDb";

const COMPASS_PREF_KEY = "mapCompassEnabled";

/** Synchronous: the map's first frame is already right. Only an explicit "on"
 *  is on — an unreadable or absent preference reads as off, like the app lock. */
export function isCompassEnabled(): boolean {
  return readPref(COMPASS_PREF_KEY) === "on";
}

/** False when the device refused to store it, so the caller can say so. */
export function setCompassEnabled(enabled: boolean): boolean {
  return writePref(COMPASS_PREF_KEY, enabled ? "on" : "off");
}
