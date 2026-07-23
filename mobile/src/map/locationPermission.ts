// Foreground location permission flow, shared by locate-me and track
// recording. Non-prompting check first: requestForegroundPermissionsAsync has
// been observed to hang on-device even when the permission is already granted.
import { Alert, Linking } from "react-native";
import * as Location from "expo-location";

/** True when granted. Denials surface an alert (never fail silently). */
export async function ensureForegroundLocationPermission(): Promise<boolean> {
  let { status, canAskAgain } = await Location.getForegroundPermissionsAsync();
  if (status !== "granted") {
    ({ status, canAskAgain } = await Location.requestForegroundPermissionsAsync());
  }
  if (status === "granted") return true;
  // Android silently auto-denies after one refusal (canAskAgain=false) —
  // the only path back is app settings.
  Alert.alert(
    "Location permission needed",
    canAskAgain
      ? "Allow location access to show your position on the map."
      : "Location was previously denied. Enable it for Logjam in system settings.",
    canAskAgain
      ? undefined
      : [
          { text: "Cancel", style: "cancel" },
          { text: "Open settings", onPress: () => Linking.openSettings() },
        ],
  );
  return false;
}
