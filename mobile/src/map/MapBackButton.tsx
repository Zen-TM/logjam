import { StyleSheet, View } from "react-native";

import { IconButton } from "../ui";
import { scrim, spacing } from "../theme";

/** Width taken by the back button, so a hint beside it can start after it. */
export const MAP_BACK_SPACE = spacing(2) + 40 + spacing(1);

/**
 * The back arrow of a page pushed over the map (the point and area pickers):
 * a pushed page has a back arrow at its top left, and these have no hero to
 * hold one. Drawn over the map, so black-and-white on a scrim (a colour over a
 * basemap is not a theme colour).
 */
export function MapBackButton({
  top,
  onPress,
}: {
  top: number;
  onPress: () => void;
}) {
  return (
    <View style={[styles.wrap, { top }]}>
      <IconButton
        icon="back"
        accessibilityLabel="Back"
        color="#ffffff"
        onPress={onPress}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: spacing(2),
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: scrim.heavy,
    alignItems: "center",
    justifyContent: "center",
  },
});
