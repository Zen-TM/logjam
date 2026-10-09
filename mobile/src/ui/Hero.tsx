import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { fontSize, fontWeight, spacing, theme } from "../theme";
import { IconButton } from "./IconButton";

/**
 * Screen-opening hero — replaces the native stack header on screens that lead
 * with a headline metric or state (`headerShown: false` on the route).
 *
 * Anatomy, top to bottom: eyebrow (uppercase kicker) · title + optional
 * trailing `actions` node on the same baseline · optional `value`/`valueSuffix`
 * display metric · optional `children` (meter, readiness pill, chips).
 *
 * It carries its own top safe-area inset and a hairline bottom edge, so the
 * screen body below it is plain padded content.
 */
export function Hero({
  eyebrow,
  title,
  titleNumberOfLines = 1,
  value,
  secondaryValue,
  valueSuffix,
  actions,
  onBack,
  children,
}: {
  eyebrow?: string;
  title: string;
  titleNumberOfLines?: number;
  value?: string;
  /**
   * A second stat of EQUAL weight beside `value`, middot-separated. The
   * download screen's estimated size and estimated time are peers — the time
   * is not supporting detail of the size, and rendering it as `valueSuffix`
   * (a smaller, muted font) said that it was.
   */
  secondaryValue?: string;
  valueSuffix?: string;
  actions?: React.ReactNode;
  /**
   * Back affordance for a hero on a PUSHED screen. A hero replaces the native
   * header, which means it also has to replace the back button it removed —
   * a gesture is not a visible way out.
   */
  onBack?: () => void;
  children?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.hero, { paddingTop: insets.top + spacing(1.5) }]}>
      {onBack ? (
        <View style={styles.backRow}>
          <IconButton
            icon="back"
            accessibilityLabel="Back"
            color={theme.text}
            onPress={onBack}
          />
          {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
        </View>
      ) : eyebrow ? (
        <Text style={styles.eyebrow}>{eyebrow}</Text>
      ) : null}
      <View style={styles.titleRow}>
        <Text style={styles.title} numberOfLines={titleNumberOfLines}>
          {title}
        </Text>
        {actions}
      </View>
      {value ? (
        <Text style={styles.value} numberOfLines={1}>
          {secondaryValue ? `${value} · ${secondaryValue}` : value}
          {valueSuffix ? (
            <Text style={styles.valueSuffix}> {valueSuffix}</Text>
          ) : null}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    // No fill: it sits on the page and a hairline separates it from the list,
    // as Logjam Web's hero does. Its old fill, a step lighter than the card,
    // failed AA under its own text in Sandstone and Ironbark.
    borderBottomWidth: 1,
    borderBottomColor: theme.line,
    paddingHorizontal: spacing(2),
    paddingBottom: spacing(2),
    gap: spacing(1),
  },
  eyebrow: {
    color: theme.textMuted,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  // The back button sits on the eyebrow line and hangs into the horizontal
  // padding, so the title still starts on the screen's text margin.
  backRow: {
    flexDirection: "row",
    alignItems: "center",
    marginLeft: -spacing(1),
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing(1.5) },
  title: {
    flex: 1,
    color: theme.text,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
  },
  // The metric is supporting information, not the point of the screen: one
  // step above body text, not a billboard. `fontSize.display` is reserved for
  // a screen whose whole purpose IS the number.
  value: {
    color: theme.text,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.medium,
  },
  valueSuffix: {
    color: theme.textMuted,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.regular,
  },
});
