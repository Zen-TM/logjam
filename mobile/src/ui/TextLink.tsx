import { Pressable, StyleSheet, Text } from "react-native";

import { fontSize, hitSlop, spacing, theme } from "../theme";

/** A small text link, centred under the content it follows. Text-coloured
 *  and underlined, never accent: words are never an intent colour. */
export function TextLink({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      hitSlop={hitSlop}
      style={styles.link}
    >
      <Text style={styles.text}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  link: { alignSelf: "center", padding: spacing(1) },
  text: {
    color: theme.text,
    fontSize: fontSize.sm,
    textDecorationLine: "underline",
  },
});
