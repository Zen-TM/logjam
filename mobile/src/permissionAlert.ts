// One shape for "the OS said no". Android stops showing its dialog after a
// refusal (`canAskAgain === false`) and from then on the only way back is app
// settings — a denial that just returns leaves a button that does nothing,
// forever, with no explanation.
import { Linking } from "react-native";

import { confirm, type ToastMessage } from "./ui";

type Listener = (message: Omit<ToastMessage, "nonce">) => void;
const toastListeners = new Set<Listener>();

/** Subscribe to the "ask again" notices: BackgroundToast, the only consumer. */
export function onPermissionToast(listener: Listener): () => void {
  toastListeners.add(listener);
  return () => toastListeners.delete(listener);
}

export function alertPermissionDenied(input: {
  title: string;
  /** Why the app wants it, when it can still be asked for. */
  askAgainMessage: string;
  /** How to get it back once Android refuses to ask again. */
  settingsMessage: string;
  canAskAgain: boolean;
  /** Where the ask-again notice goes instead of the toast: a caller inside a
   *  sheet, whose modal would hide the toast. */
  onMessage?: (text: string) => void;
}): void {
  if (input.canAskAgain) {
    if (input.onMessage) {
      input.onMessage(input.askAgainMessage);
      return;
    }
    for (const listener of toastListeners)
      listener({ text: input.askAgainMessage, tone: "error" });
    return;
  }
  void confirm({
    confirmTitle: input.title,
    confirmBody: input.settingsMessage,
    confirmLabel: "Open settings",
    tone: "filled",
  }).then((open) => {
    if (open) void Linking.openSettings();
  });
}
