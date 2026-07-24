import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";

import { fontSize, fontWeight, hitSlop, radius, spacing, surface, theme } from "../theme";

// Canonical list row — one warm card laid out horizontally: optional leading
// node (icon/dot/thumbnail), a title + optional subtitle, and an optional
// trailing accessory (StatusPill, chevron, Toggle, custom). Replaces the
// `rgba(255,255,255,0.04)` rows hand-rolled across Canyons/Trips/Account/
// Notifications/Friends/CanyonDetail. Non-pressable when `onPress` is omitted.
export function Row({
  title,
  subtitle,
  leading,
  right,
  onPress,
  accessibilityLabel,
  titleNumberOfLines = 1,
  style,
}: {
  title: string;
  subtitle?: string;
  leading?: React.ReactNode;
  right?: React.ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  titleNumberOfLines?: number;
  style?: ViewStyle | ViewStyle[];
}) {
  const body = (
    <>
      {leading != null ? <View style={styles.leading}>{leading}</View> : null}
      <View style={styles.main}>
        <Text style={styles.title} numberOfLines={titleNumberOfLines}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right != null ? <View style={styles.right}>{right}</View> : null}
    </>
  );

  if (!onPress) {
    return <View style={[styles.row, style]}>{body}</View>;
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      onPress={onPress}
      hitSlop={hitSlop}
      style={({ pressed }) => [styles.row, pressed && styles.pressed, style]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing(1.5),
    backgroundColor: surface.card,
    borderWidth: 1,
    borderColor: surface.border,
    borderRadius: radius.md,
    padding: spacing(1.5),
    minHeight: 56,
  },
  pressed: { backgroundColor: surface.cardPressed },
  leading: { alignItems: "center", justifyContent: "center" },
  main: { flex: 1, gap: spacing(0.25) },
  right: { alignItems: "flex-end", justifyContent: "center", gap: spacing(0.5) },
  title: { color: theme.textPrimary, fontSize: fontSize.base, fontWeight: fontWeight.medium },
  subtitle: { color: theme.textMuted, fontSize: fontSize.sm },
});
