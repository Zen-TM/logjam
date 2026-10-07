import { StyleSheet, Text, View } from "react-native";

import { fontSize, fontWeight, radius, spacing, theme } from "../theme";
import { Icon, type Glyph } from "./Icon";
import { PILL_HEIGHT } from "./pill";

// Small status chip. `accent` = filled (active/saved-for-offline), `outline` =
// neutral bordered (Shared / Online), `warning` = attention (Update / error),
// `muted` = de-emphasised state that is not a problem (Queued / Paused).
// The palette has no dedicated success green, so "saved offline" reads as the
// filled accent — the strongest on-palette affirmative.
//
// Pills are fully rounded and never wider than their text; an optional `icon`
// carries state for glance-reading (check = ready, alert = needs attention).
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
   * Identity colour override — fills the pill with `hue` under the `onFill`
   * ink. For a pill that says *what a thing is* (a trip type) rather than how
   * it is going; the four tones stay the vocabulary for state. A hue is a
   * fill, never letters on a surface (it fails 3:1 on the light page).
   */
  hue?: string;
}) {
  const color = hue != null ? theme.onFill : TONE_TEXT[tone];
  const glyph = hue != null ? theme.onFill : TONE_GLYPH[tone];
  return (
    <View
      style={[
        styles.base,
        styles[`${tone}Box`],
        hue != null && {
          borderWidth: 1,
          borderColor: hue,
          backgroundColor: hue,
        },
      ]}
    >
      {icon ? <Icon idea={icon} size={12} color={glyph} /> : null}
      <Text style={[styles.label, { color }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

// Words are `text` or `textMuted`, never an intent colour (as on Logjam Web):
// a warning pill says so with its edge and glyph.
const TONE_TEXT: Record<PillTone, string> = {
  accent: theme.onFill,
  outline: theme.textMuted,
  warning: theme.text,
  muted: theme.textMuted,
};

const TONE_GLYPH: Record<PillTone, string> = {
  ...TONE_TEXT,
  warning: theme.warning,
};

const styles = StyleSheet.create({
  base: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(0.5),
    borderRadius: radius.pill,
    paddingHorizontal: spacing(1),
    paddingVertical: spacing(0.375),
    alignSelf: "flex-start",
    // A pill is never narrower than it is tall: a one-digit count is a circle.
    minHeight: PILL_HEIGHT,
    minWidth: PILL_HEIGHT,
    justifyContent: "center",
  },
  label: { fontSize: fontSize.xs, fontWeight: fontWeight.medium },
  accentBox: { backgroundColor: theme.accent },
  outlineBox: { borderWidth: 1, borderColor: theme.textMuted },
  warningBox: { borderWidth: 1, borderColor: theme.warning },
  // Quiet is the absence of the outline. The old fill under the muted label
  // fell under 4.5:1 in Sandstone.
  mutedBox: { borderWidth: 1, borderColor: "transparent" },
});
