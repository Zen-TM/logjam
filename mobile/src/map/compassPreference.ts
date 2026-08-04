// The compass tape's on/off switch (Settings → This phone).
//
// DEVICE-scoped like the app lock, and for the same kind of reason: it is a
// statement about this handset (it runs the magnetometer, and a phone whose
// compass reads badly is a phone-specific problem), not an account preference
// to push to the user's other devices.
//
// Defaults to ON — it costs a sensor subscription that only runs while the map
// is on screen, and an instrument you have to go and find is one you won't have
// when you need it.
import { readPref, writePref } from "../prefsDb";

const COMPASS_PREF_KEY = "mapCompassEnabled";

/** Synchronous: the map's first frame is already right. Anything but an explicit "off" is on. */
export function isCompassEnabled(): boolean {
  return readPref(COMPASS_PREF_KEY) !== "off";
}

/** False when the device refused to store it, so the caller can say so. */
export function setCompassEnabled(enabled: boolean): boolean {
  return writePref(COMPASS_PREF_KEY, enabled ? "on" : "off");
}
