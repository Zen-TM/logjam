import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { fontSize, fontWeight, radius, spacing, theme, withAlpha } from "../theme";

/**
 * Screen-opening hero — replaces the native stack header on screens that lead
 * with a headline metric or state (`headerShown: false` on the route).
 *
 * Anatomy, top to bottom: eyebrow (uppercase kicker) · title + optional
 * trailing `action` node on the same baseline · optional `value`/`valueSuffix`
 * display metric · optional `children` (meter, readiness pill, chips).
 *
 * It carries its own top safe-area inset and a hairline bottom edge, so the
 * screen body below it is plain padded content.
 */
export function HeroHeader({
  eyebrow,
  title,
  value,
  valueSuffix,
  action,
  children,
}: {
  eyebrow?: string;
  title: string;
  value?: string;
  valueSuffix?: string;
  action?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.hero, { paddingTop: insets.top + spacing(1.5) }]}>
      {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
      <View style={styles.titleRow}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {action}
      </View>
      {value ? (
        <Text style={styles.value}>
          {value}
          {valueSuffix ? <Text style={styles.valueSuffix}> {valueSuffix}</Text> : null}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    // One step lighter than the card surface, so the stack reads
    // hero > card > page and the header lifts off the list below it.
    backgroundColor: theme.bonus2,
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
    borderBottomWidth: 1,
    borderBottomColor: withAlpha(theme.accent, 0.25),
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
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing(1.5) },
  title: {
    flex: 1,
    color: theme.textPrimary,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
  },
  // The metric is supporting information, not the point of the screen: one
  // step above body text, not a billboard. `fontSize.display` is reserved for
  // a screen whose whole purpose IS the number.
  value: {
    color: theme.textPrimary,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.medium,
  },
  valueSuffix: {
    color: theme.textMuted,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.regular,
  },
});
