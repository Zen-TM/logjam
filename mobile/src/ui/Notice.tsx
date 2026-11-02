import { Text, View } from "react-native";

import { radius, spacing, makeStyles, useTheme, controlSize } from "../theme";
import { Icon, type Glyph } from "./Icon";

/**
 * A notice pinned over the map: something true about what the map is showing
 * right now (filtered, saving, offline, a warning). The same component as
 * Logjam Web's `Notice`.
 *
 * It sits on the page colour, not a scrim: a scrim under `text` is dark on dark
 * in Ghost Gum. Its words are `text`, centred IN the notice (a pill that is
 * centred on the screen but whose words hug the left reads as drifting); the
 * intent is the glyph, and `tone="warning"` adds the warning edge.
 * `tone="critical"` is for data being lost right now: the warning fill with
 * `onFill` words, first in the stack (shared/DESIGN.md §1, §15). It always
 * carries a glyph (accent and warning share a luminance), so `icon` is
 * required by type.
 * Over the map it is not pressable, so it never eats a pan; `action` is the one
 * pressable beside the words, and `controls` a row of them under the words, for
 * a notice that is a mode with ways out (plan mode on the map).
 */
export function Notice({
  icon,
  children,
  action,
  controls,
  numberOfLines,
  tone = "info",
}: {
  children: string;
  /** Trailing control that answers the notice (an `IconButton`). */
  action?: React.ReactNode;
  /** Controls in a row under the words. */
  controls?: React.ReactNode;
  /** A user's own title in the words stops at two lines (shared/DESIGN.md §9). */
  numberOfLines?: number;
} & (
  | { tone?: "info" | "warning"; icon?: Glyph }
  | { tone: "critical"; icon: Glyph }
)) {
  const theme = useTheme();
  const styles = useStyles();

  const critical = tone === "critical";
  const warning = tone === "warning" || critical;
  const line = (
    <>
      {icon ? (
        <Icon
          idea={icon}
          size={16}
          color={
            critical ? theme.onFill : warning ? theme.warning : theme.accent
          }
        />
      ) : null}
      <Text
        style={[styles.text, critical && styles.criticalText]}
        numberOfLines={numberOfLines}
      >
        {children}
      </Text>
      {action}
    </>
  );
  return (
    <View
      style={[
        styles.notice,
        controls != null && styles.stacked,
        warning && styles.warning,
        critical && styles.critical,
      ]}
      accessibilityRole={warning ? "alert" : undefined}
    >
      {controls ? (
        <>
          <View style={styles.line}>{line}</View>
          <View style={styles.controls}>{controls}</View>
        </>
      ) : (
        line
      )}
    </View>
  );
}

const useStyles = makeStyles((theme, textRole) => ({
  notice: {
    alignSelf: "center",
    maxWidth: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(1),
    minHeight: controlSize.md,
    paddingHorizontal: spacing(1.5),
    paddingVertical: spacing(0.5),
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: theme.line,
    backgroundColor: theme.page,
  },
  warning: { borderColor: theme.warning },
  critical: { backgroundColor: theme.warning },
  criticalText: { color: theme.onFill },
  stacked: { flexDirection: "column", paddingVertical: spacing(1) },
  line: { flexDirection: "row", alignItems: "center", gap: spacing(1) },
  controls: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: spacing(1),
  },
  // `flexShrink`, not `flex: 1`: the notice hugs its words until they wrap.
  text: {
    flexShrink: 1,
    ...textRole.detail,
    color: theme.text,
    textAlign: "center",
  },
}));
