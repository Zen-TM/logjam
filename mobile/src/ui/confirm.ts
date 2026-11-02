import { Alert } from "react-native";
import type { ConfirmCopy } from "@logjam/shared";

/**
 * The one way Logjam GPS raises an `Alert` (mobile/DESIGN.md §4): Cancel and
 * the verb, never a second wording of Cancel. Resolves true on the verb and
 * false on Cancel or a dismissal.
 */
export function confirm(copy: ConfirmCopy): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      copy.confirmTitle,
      copy.confirmBody,
      [
        { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
        {
          text: copy.confirmLabel,
          style: copy.tone === "destructive" ? "destructive" : "default",
          onPress: () => resolve(true),
        },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
