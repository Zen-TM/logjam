import { AndroidHaptics, performAndroidHapticsAsync } from "expo-haptics";

/**
 * The one tick a press-and-hold gives when it fires and commits, so a hold
 * through a glove or a dry bag is known to have registered. Nothing else in
 * Logjam GPS vibrates (mobile/DESIGN.md §3).
 *
 * View haptics, not `Vibrator`: no permission, which is why `app.json` blocks
 * the `VIBRATE` the library declares. The call cannot report a refusal, and
 * Samsung's engine on the Galaxy S9 refuses every constant it maps ("not
 * supported for engine" in logcat; `Context_Click` and `Clock_Tick` are not
 * sent to it at all), so that phone gives no tick. Phones whose View haptics
 * work do.
 */
export function holdTick(): void {
  performAndroidHapticsAsync(AndroidHaptics.Long_Press).catch(() => undefined);
}
