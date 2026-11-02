import { Alert } from "react-native";
import type { ConfirmCopy } from "@logjam/shared";

/**
 * The one way Logjam GPS raises an `Alert` (mobile/DESIGN.md §4): Cancel and
 * the verb, never a second wording of Cancel. Resolves true on the verb and
 * false on Cancel or a dismissal.
 *
 * `cancelLabel` is the one exception, for the second step of a two-step verb
 * where "Cancel" would read as backing out of the whole thing: removing a
 * member who has files asks "Keep files" / "Delete files" after the first
 * confirm has already said yes. Only `plans/PeopleView.tsx` may pass it
 * (`confirm.test.ts`, "cancelLabel is passed only by the second step").
 */
export function confirm(
  copy: ConfirmCopy,
  options?: { cancelLabel?: string },
): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      copy.confirmTitle,
      copy.confirmBody,
      [
        {
          text: options?.cancelLabel ?? "Cancel",
          style: "cancel",
          onPress: () => resolve(false),
        },
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
