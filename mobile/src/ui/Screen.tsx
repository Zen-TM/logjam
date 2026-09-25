import {
  ScrollView,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";

import { spacing, theme } from "../theme";

// Layout primitives so screens stop re-deriving `flex:1 + theme.primary +
// padding + gap` scaffolding. `Screen` is a non-scrolling container; most list
// screens want `ScreenScroll`.

export function Screen({
  children,
  padded = true,
  style,
}: {
  children: React.ReactNode;
  padded?: boolean;
  style?: ViewStyle | ViewStyle[];
}) {
  return (
    <View style={[styles.root, padded && styles.padded, style]}>{children}</View>
  );
}

export function ScreenScroll({
  children,
  padded = true,
  contentStyle,
}: {
  children: React.ReactNode;
  padded?: boolean;
  contentStyle?: ViewStyle | ViewStyle[];
}) {
  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[
        styles.scrollContent,
        padded && styles.padded,
        contentStyle,
      ]}
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.primary },
  padded: { padding: spacing(2) },
  scrollContent: { gap: spacing(1), paddingBottom: spacing(4) },
});
