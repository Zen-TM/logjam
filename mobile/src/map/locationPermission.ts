// Foreground location permission flow, shared by locate-me and track
// recording. Non-prompting check first: requestForegroundPermissionsAsync has
// been observed to hang on-device even when the permission is already granted.
import * as Location from "expo-location";

import { alertPermissionDenied } from "../permissionAlert";

/** True when granted. Denials surface an alert (never fail silently). */
export async function ensureForegroundLocationPermission(): Promise<boolean> {
  let { status, canAskAgain } = await Location.getForegroundPermissionsAsync();
  if (status !== "granted") {
    ({ status, canAskAgain } = await Location.requestForegroundPermissionsAsync());
  }
  if (status === "granted") return true;
  // Android silently auto-denies after one refusal (canAskAgain=false) —
  // the only path back is app settings.
  alertPermissionDenied({
    title: "Location permission needed",
    askAgainMessage: "Allow location access to show your position on the map.",
    settingsMessage:
      "Location was previously denied. Enable it for Logjam in system settings.",
    canAskAgain,
  });
  return false;
}
