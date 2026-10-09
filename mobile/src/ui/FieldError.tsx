import { useContext, useEffect, useRef } from "react";
import { StyleSheet, Text, View } from "react-native";

import { fontSize, spacing, theme } from "../theme";
import { SheetErrorReveal } from "./BottomSheet";
import { Icon } from "./Icon";

/**
 * The one inline validation line (docs/ux-principles.md §11, "Form errors"): directly under
 * the control it is about: the words in `text` and a warning glyph before them,
 * because words are never an intent colour (UX §7). `TextField` and `ChipPicker`
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
    <View ref={ref} collapsable={false} style={styles.line}>
      <Icon idea="warning" size={14} color={theme.warning} />
      {/* Announced when it appears: a validation message that only exists on
          screen is a message a screen-reader user has to go hunting for. */}
      <Text style={styles.error} accessibilityLiveRegion="polite">
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: "row", alignItems: "flex-start", gap: spacing(0.75) },
  // The glyph sits on the first line of the text, whatever the text size.
  error: { flex: 1, fontSize: fontSize.sm, color: theme.text },
});
