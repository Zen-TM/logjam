import { useContext, useEffect, useRef } from "react";
import { StyleSheet, Text, View } from "react-native";

import { fontSize, theme } from "../theme";
import { SheetErrorReveal } from "./BottomSheet";

/**
 * The one inline validation line (DESIGN.md §8, "Form errors"): directly under
 * the control it is about, in the warning tone. `TextField` and `ChipPicker`
 * render it from their `error` prop; any other control puts one under itself.
 * Null or empty renders nothing.
 *
 * Inside a `BottomSheet` it reports itself when it APPEARS, so a submit that
 * turns up an error below the fold scrolls to it.
 * ponytail: a form on a plain screen (ScreenScroll) does not scroll to its
 * errors — every one today is a few fields tall. Give ScreenScroll the same
 * context when one isn't.
 */
export function FieldError({ message }: { message?: string | null }) {
  const ref = useRef<View>(null);
  const reveal = useContext(SheetErrorReveal);
  const shown = Boolean(message);
  useEffect(() => {
    if (shown && reveal != null && ref.current != null) reveal(ref.current);
  }, [shown, reveal]);
  if (!shown) return null;
  return (
    // Not collapsable: Android flattens a style-less View away, and a flattened
    // view cannot be measured against the sheet's content.
    <View ref={ref} collapsable={false}>
      {/* Announced when it appears: a validation message that only exists on
          screen is a message a screen-reader user has to go hunting for. */}
      <Text style={styles.error} accessibilityLiveRegion="polite">
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  error: { fontSize: fontSize.sm, color: theme.warning },
});
