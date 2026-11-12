import { View } from "react-native";

import { IconButton } from "../ui";
import { makeStyles, spacing, useTheme } from "../theme";

/** Width taken by the back button, so a hint beside it can start after it. */
export const MAP_BACK_SPACE = spacing(2) + 40 + spacing(1);

/**
 * The back arrow of a page pushed over the map (the point and area pickers):
 * a pushed page has a back arrow at its top left, and these have no hero to
 * hold one. A map control, so a card with a hairline edge like the rest of the
 * chrome (the map's buttons), not a black veil.
 */
export function MapBackButton({
  top,
  onPress,
}: {
  top: number;
  onPress: () => void;
}) {
  const theme = useTheme();
  const styles = useStyles();
  return (
    <View style={[styles.wrap, { top }]}>
      <IconButton
        icon="back"
        accessibilityLabel="Back"
        color={theme.text}
        onPress={onPress}
      />
    </View>
  );
}

const useStyles = makeStyles((theme) => ({
  wrap: {
    position: "absolute",
    left: spacing(2),
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.line,
    alignItems: "center",
    justifyContent: "center",
  },
}));
