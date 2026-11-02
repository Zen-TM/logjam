import { AccessibilityInfo, Platform, ToastAndroid } from "react-native";

/** Android queues its system toasts, so a repeated press would keep the
 *  reason up long after the last one. */
const REPEAT_MS = 2000;
let last = { reason: "", at: 0 };

/**
 * A control that could apply but does not right now says why (shared/DESIGN.md
 * §5), and a press is where a thumb asks. It is the system toast on Android,
 * because the controls that need it sit in sheets, which are Modals: the
 * shell's toast would be drawn behind them. Elsewhere the reason is only
 * announced to a screen reader: nothing is drawn for a sighted user yet.
 * Guard: disabledPressed.test.ts.
 */
export function showDisabledReason(reason: string): void {
  const now = Date.now();
  if (reason === last.reason && now - last.at < REPEAT_MS) return;
  last = { reason, at: now };
  if (Platform.OS === "android") ToastAndroid.show(reason, ToastAndroid.SHORT);
  else AccessibilityInfo.announceForAccessibility(reason);
}

/**
 * `disabled` and `disabledReason` come as a pair, so the compiler refuses a bare
 * `disabled={…}`; the same union as Logjam Web's `Disablable`. A reason with
 * nothing to disable would say nothing, and is refused too. `reasonShown` says
 * the reason is already on screen (under the control, or as its row's
 * subtitle), so a press does not toast it a second time.
 */
export type Disablable =
  | { disabled?: false; disabledReason?: undefined; reasonShown?: undefined }
  | { disabled: boolean; disabledReason: string; reasonShown?: boolean };
