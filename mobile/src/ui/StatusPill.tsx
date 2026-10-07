import { StyleSheet, Text, View } from "react-native";

import { fontSize, fontWeight, radius, spacing, theme } from "../theme";
import { Icon, type Glyph } from "./Icon";
import { PILL_HEIGHT } from "./pill";

// A status pill is READ, not pressed, so it draws no fill and no edge (UX §4:
// filled is interactive). The tone is carried by a dot or a glyph beside words
// in the text colour: `accent` = active / saved-for-offline, `warning` =
// attention (Update / error), `outline` and `muted` = quiet state (Shared /
// Queued / Paused), muted words with no dot. An optional `icon` carries state for
// glance-reading (check = ready, alert = needs attention) in place of the dot.
// Guard: `pressableFill.test.ts`.
type PillTone = "accent" | "outline" | "warning" | "muted";

export function StatusPill({
  label,
  tone = "outline",
  icon,
  hue,
}: {
  label: string;
  tone?: PillTone;
  icon?: Glyph;
  /**
   * Identity colour: a dot of `hue` says *what a thing is* (a trip type) rather
   * than how it is going; the four tones stay the vocabulary for state. A hue is
   * a fill, never letters on a surface, so it is only ever the dot.
   */
  hue?: string;
}) {
  const dot = hue ?? TONE_DOT[tone];
  return (
    <View style={styles.base}>
      {icon ? <Icon idea={icon} size={12} color={TONE_GLYPH[tone]} /> : null}
      {!icon || hue != null ? (
        dot != null ? (
          <View style={[styles.dot, { backgroundColor: dot }]} />
        ) : null
      ) : null}
      <Text
        style={[styles.label, { color: TONE_TEXT[tone] }]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
}

// Words are `text` or `textMuted`, never an intent colour (as on Logjam Web):
// the dot or the glyph says the tone.
const TONE_TEXT: Record<PillTone, string> = {
  accent: theme.text,
  outline: theme.textMuted,
  warning: theme.text,
  muted: theme.textMuted,
};

const TONE_GLYPH: Record<PillTone, string> = {
  accent: theme.accent,
  outline: theme.textMuted,
  warning: theme.warning,
  muted: theme.textMuted,
};

// The tones with something to say get a dot; the quiet ones do not.
const TONE_DOT: Record<PillTone, string | undefined> = {
  accent: theme.accent,
  outline: undefined,
  warning: theme.warning,
  muted: undefined,
};

const styles = StyleSheet.create({
  base: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(0.5),
    alignSelf: "flex-start",
    minHeight: PILL_HEIGHT,
    minWidth: PILL_HEIGHT,
    justifyContent: "center",
  },
  dot: { width: 8, height: 8, borderRadius: radius.pill },
  label: { fontSize: fontSize.xs, fontWeight: fontWeight.medium },
});
