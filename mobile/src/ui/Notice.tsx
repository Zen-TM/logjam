import { StyleSheet, Text, View } from "react-native";

import { fontSize, radius, spacing, theme } from "../theme";
import { Icon, type Glyph } from "./Icon";

/**
 * A notice pinned over the map: something true about what the map is showing
 * right now (filtered, saving, offline, a warning). The same component as
 * Logjam Web's `Notice`.
 *
 * It sits on the page colour, not a scrim: a scrim under `text` is dark on dark
 * in Daylight. Its words are `text`, centred IN the notice (a pill that is
 * centred on the screen but whose words hug the left reads as drifting); the
 * intent is the glyph, and `tone="warning"` adds the warning edge.
 * Over the map it is not pressable, so it never eats a pan; `action` is the one
 * pressable inside it.
 */
export function Notice({
  icon,
  children,
  action,
  tone = "info",
}: {
  icon?: Glyph;
  children: string;
  /** Trailing control that answers the notice (an `IconButton`). */
  action?: React.ReactNode;
  tone?: "info" | "warning";
}) {
  const warning = tone === "warning";
  return (
    <View
      style={[styles.notice, warning && styles.warning]}
      accessibilityRole={warning ? "alert" : undefined}
    >
      {icon ? (
        <Icon
          idea={icon}
          size={16}
          color={warning ? theme.warning : theme.accent}
        />
      ) : null}
      <Text style={styles.text}>{children}</Text>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    alignSelf: "center",
    maxWidth: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(1),
    minHeight: 36,
    paddingHorizontal: spacing(1.5),
    paddingVertical: spacing(0.5),
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: theme.line,
    backgroundColor: theme.page,
  },
  warning: { borderColor: theme.warning },
  // `flexShrink`, not `flex: 1`: the notice hugs its words until they wrap.
  text: {
    flexShrink: 1,
    color: theme.text,
    fontSize: fontSize.sm,
    textAlign: "center",
  },
});
