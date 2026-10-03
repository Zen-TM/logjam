import { StyleSheet, View, type ViewStyle } from "react-native";

import { radius, spacing, theme } from "../theme";

// Rounded warm surface for grouped content — place/list rows, layer-sheet
// rows, stat panels. One card look so every screen matches.
export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
}) {
  return <View style={[styles.card, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: radius.md,
    padding: spacing(1.5),
  },
});
