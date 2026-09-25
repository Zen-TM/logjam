import { Feather } from "@expo/vector-icons";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";

import {
  fontSize,
  fontWeight,
  hitSlop,
  radius,
  spacing,
  surface,
  theme,
  withAlpha,
} from "../theme";

// Canonical list row — one warm card laid out horizontally: a leading node
// (icon tile / dot / thumbnail), a title + optional subtitle, and an optional
// trailing accessory (StatusPill, chevron, Toggle, action buttons).
// Non-pressable when `onPress` is omitted.
//
// Pass `icon` + `hue` for the standard identity tile: a 40pt rounded square
// tinted with the hue at 16% behind a hue-coloured glyph. That tile is how a
// list of mixed kinds stays scannable — colour and glyph say *what* a row is
// before the text is read — so prefer it over a bare `leading` node whenever
// the row has a kind. `progress` (0-1) draws a hue-coloured determinate bar
// pinned to the row's bottom edge for in-flight work.
export function Row({
  title,
  subtitle,
  leading,
  icon,
  hue,
  right,
  footer,
  progress,
  onPress,
  onLongPress,
  selected = false,
  disabled = false,
  accessibilityLabel,
  // TWO lines for the title, and that is a text-size rule rather than a taste
  // one: at a large OS font setting (or a large in-app multiplier) a one-line
  // cap turned "Auto-download finished GeoPDFs" into "Auto-download finis…"
  // with no way to read the rest. A row that grows is legible; a row that
  // truncates is a dead end. Two rather than unlimited, because a title is
  // often a user-supplied NAME and a pasted paragraph should not become a
  // screen-tall row. Pass 1 where a single line is load-bearing.
  titleNumberOfLines = 2,
  // The subtitle is UNCAPPED by default: it is our own copy, not user data, and
  // it is where the explanations live ("Every layer of every finished job, once
  // each"). Any fixed cap is a sentence that survives at one text size and is
  // cut off at the next — two lines was simply a bigger size at which to fail.
  subtitleNumberOfLines,
  style,
}: {
  title: string;
  subtitle?: string;
  leading?: React.ReactNode;
  icon?: React.ComponentProps<typeof Feather>["name"];
  hue?: string;
  right?: React.ReactNode;
  /**
   * Full-width content pinned under the row's own line, INSIDE the card — the
   * slot for per-row actions that don't fit the trailing accessory (§5's order
   * runs out at one inline action). Keeping them inside the card is what says
   * which row they belong to; floating them underneath reads as a caption for
   * the row below.
   */
  footer?: React.ReactNode;
  progress?: number | null;
  onPress?: () => void;
  /** Press-and-hold — the way a multi-select starts (DESIGN.md §7). */
  onLongPress?: () => void;
  /**
   * Picked: accent border + accent tint over the whole card. The canonical
   * "a selection is a STATE of the row, not a label on it" treatment — the
   * active basemap and a multi-selected saved asset are the same thing.
   */
  selected?: boolean;
  /**
   * Unavailable right now, with the reason in the subtitle. Dims the row AND
   * stops it responding — dropping `onPress` alone leaves a row that looks
   * live and silently does nothing, which is worse than a visibly dead one.
   */
  disabled?: boolean;
  accessibilityLabel?: string;
  titleNumberOfLines?: number;
  /** Raise it when the subtitle is a short explanation rather than a status. */
  subtitleNumberOfLines?: number;
  style?: ViewStyle | ViewStyle[];
}) {
  const tint = hue ?? theme.accent;
  const lead =
    leading ??
    (icon ? (
      <View style={[styles.iconTile, { backgroundColor: withAlpha(tint, 0.16) }]}>
        <Feather name={icon} size={20} color={tint} />
      </View>
    ) : null);

  // The card is a COLUMN so a footer can sit under the line; the line keeps the
  // horizontal layout every row has always had. `progress` stays a direct child
  // of the card, not of the line: it is absolutely positioned against the card's
  // padding box, and nesting it would inset the bar by the card's padding.
  const body = (
    <>
      <View style={styles.line}>
        {lead != null ? <View style={styles.leading}>{lead}</View> : null}
        <View style={styles.main}>
          <Text style={styles.title} numberOfLines={titleNumberOfLines}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={styles.subtitle} numberOfLines={subtitleNumberOfLines}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {right != null ? <View style={styles.right}>{right}</View> : null}
      </View>
      {footer != null ? <View style={styles.footer}>{footer}</View> : null}
      {progress != null ? (
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              {
                backgroundColor: tint,
                width: `${Math.min(100, Math.max(0, progress * 100))}%`,
              },
            ]}
          />
        </View>
      ) : null}
    </>
  );

  if ((!onPress && !onLongPress) || disabled) {
    return (
      <View
        style={[styles.row, selected && styles.selected, disabled && styles.disabled, style]}
      >
        {body}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled, selected }}
      onPress={onPress}
      onLongPress={onLongPress}
      hitSlop={hitSlop}
      style={({ pressed }) => [
        styles.row,
        selected && styles.selected,
        pressed && styles.pressed,
        style,
      ]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    // Column + centred: with no footer this lays out exactly as the old
    // flex-row card did (one full-width child, vertically centred when the
    // 56pt floor bites).
    justifyContent: "center",
    backgroundColor: surface.card,
    borderWidth: 1,
    borderColor: surface.border,
    borderRadius: radius.lg,
    padding: spacing(1.5),
    minHeight: 56,
    overflow: "hidden",
  },
  line: { flexDirection: "row", alignItems: "center", gap: spacing(1.5) },
  footer: { paddingTop: spacing(1.25) },
  pressed: { backgroundColor: surface.cardPressed },
  selected: {
    borderColor: theme.accent,
    backgroundColor: withAlpha(theme.accent, 0.12),
  },
  disabled: { opacity: 0.45 },
  leading: { alignItems: "center", justifyContent: "center" },
  iconTile: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  main: { flex: 1, gap: spacing(0.25) },
  right: { alignItems: "flex-end", justifyContent: "center", gap: spacing(0.5) },
  title: { color: theme.textPrimary, fontSize: fontSize.base, fontWeight: fontWeight.medium },
  subtitle: { color: theme.textMuted, fontSize: fontSize.sm },
  progressTrack: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    backgroundColor: withAlpha(theme.textPrimary, 0.1),
  },
  progressFill: { height: 3, borderRadius: radius.pill },
});
