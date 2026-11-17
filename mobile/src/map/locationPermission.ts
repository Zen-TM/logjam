// Foreground location permission flow, shared by locate-me and track
// recording. Non-prompting check first: requestForegroundPermissionsAsync can
// hang on-device even when the permission is already granted.
import * as Location from "expo-location";

import { alertPermissionDenied } from "../permissionAlert";
import { t } from "@logjam/shared";

/** True when granted. Denials are said out loud (never fail silently): a
 *  toast, or `onMessage` where a modal would cover one. */
export async function ensureForegroundLocationPermission(
  onMessage?: (text: string) => void,
): Promise<boolean> {
  let { status, canAskAgain } = await Location.getForegroundPermissionsAsync();
  if (status !== "granted") {
    ({ status, canAskAgain } =
      await Location.requestForegroundPermissionsAsync());
  }
  if (status === "granted") return true;
  // Android silently auto-denies after one refusal (canAskAgain=false) —
  // the only path back is app settings.
  alertPermissionDenied({
    title: t`Location permission needed`,
    askAgainMessage: t`Allow location access to show your position on the map.`,
    settingsMessage: t`Location is off. Turn it on for Logjam GPS in system settings.`,
    canAskAgain,
    onMessage,
  });
  return false;
}
