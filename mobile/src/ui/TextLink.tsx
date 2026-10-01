import { Pressable, StyleSheet, Text } from "react-native";

import { fontSize, spacing, theme } from "../theme";

/** A small accent-coloured text link, centred under the content it follows. */
export function TextLink({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="link" style={styles.link}>
      <Text style={styles.text}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  link: { alignSelf: "center", padding: spacing(1) },
  text: { color: theme.accent, fontSize: fontSize.sm },
});
