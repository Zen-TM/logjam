import { AndroidHaptics, performAndroidHapticsAsync } from "expo-haptics";

/**
 * The one tick a press-and-hold gives when it fires and commits, so a hold
 * through a glove or a dry bag is known to have registered. Nothing else in
 * Logjam GPS vibrates (mobile/DESIGN.md §3).
 *
 * View haptics, not `Vibrator`: no permission, which is why `app.json` blocks
 * the `VIBRATE` the library declares. A phone with touch feedback switched off
 * stays silent, which is the user's choice.
 */
export function holdTick(): void {
  performAndroidHapticsAsync(AndroidHaptics.Long_Press).catch(() => undefined);
}
