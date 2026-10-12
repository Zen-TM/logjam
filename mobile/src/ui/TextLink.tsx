import { Pressable, Text } from "react-native";

import { hitSlop, spacing, makeStyles } from "../theme";

/** A small text link, centred under the content it follows. Text-coloured
 *  and underlined, never accent: words are never an intent colour. */
export function TextLink({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  const styles = useStyles();

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

const useStyles = makeStyles((theme, textRole) => ({
  link: { alignSelf: "center", padding: spacing(1) },
  text: {
    ...textRole.detail,
    color: theme.text,
    textDecorationLine: "underline",
  },
}));
