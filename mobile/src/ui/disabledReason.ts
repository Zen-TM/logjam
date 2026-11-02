import { AccessibilityInfo, Platform, ToastAndroid } from "react-native";

/**
 * A control that could apply but does not right now says why (shared/DESIGN.md
 * §5), and a press is where a thumb asks. It is the system toast on Android,
 * because the controls that need it sit in sheets, which are Modals: the
 * shell's toast would be drawn behind them. Elsewhere the reason is announced
 * to a screen reader; Logjam GPS ships on Android only.
 */
export function showDisabledReason(reason: string): void {
  if (Platform.OS === "android") ToastAndroid.show(reason, ToastAndroid.SHORT);
  else AccessibilityInfo.announceForAccessibility(reason);
}

/**
 * `disabled` and `disabledReason` come as a pair, so the compiler refuses a bare
 * `disabled={…}`; the same union as Logjam Web's `Disablable`. A reason with
 * nothing to disable would say nothing, and is refused too.
 */
export type Disablable =
  | { disabled?: false; disabledReason?: undefined }
  | { disabled: boolean; disabledReason: string };
