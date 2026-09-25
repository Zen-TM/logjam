// One shape for "the OS said no". Android stops showing its dialog after a
// refusal (`canAskAgain === false`) and from then on the only way back is app
// settings — a denial that just returns leaves a button that does nothing,
// forever, with no explanation.
import { Alert, Linking } from "react-native";

export function alertPermissionDenied(input: {
  title: string;
  /** Why the app wants it, when it can still be asked for. */
  askAgainMessage: string;
  /** How to get it back once Android refuses to ask again. */
  settingsMessage: string;
  canAskAgain: boolean;
}): void {
  Alert.alert(
    input.title,
    input.canAskAgain ? input.askAgainMessage : input.settingsMessage,
    input.canAskAgain
      ? undefined
      : [
          { text: "Cancel", style: "cancel" },
          { text: "Open settings", onPress: () => Linking.openSettings() },
        ],
  );
}
