import { StyleSheet, Text } from "react-native";

import { fontSize, spacing, theme } from "../theme";

// Uppercase, letter-spaced section label — the one heading style shared by the
// layer sheet, forms (TextField reuses the same treatment), and list sections.
export function SectionHeader({ label }: { label: string }) {
  return <Text style={styles.header}>{label}</Text>;
}

const styles = StyleSheet.create({
  header: {
    fontSize: fontSize.xs,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    color: theme.textMuted,
    marginTop: spacing(2),
    marginBottom: spacing(0.5),
  },
});
