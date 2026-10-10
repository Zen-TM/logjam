import { StyleSheet, Text } from "react-native";

import { formRhythm, textRole } from "../theme";

// Uppercase, letter-spaced section label — the one heading style shared by the
// layer sheet, forms (TextField reuses the same treatment), and list sections.
export function SectionHeader({
  title,
  count,
}: {
  title: string;
  /** How many the section holds: "TRIPS · 3". The same prop Logjam Web takes. */
  count?: number;
}) {
  return (
    <Text style={styles.header} accessibilityRole="header">
      {count != null ? `${title} · ${count}` : title}
    </Text>
  );
}

const styles = StyleSheet.create({
  header: {
    ...textRole.section,
    letterSpacing: 0.8,
    marginTop: formRhythm.section,
    marginBottom: formRhythm.label,
  },
});
