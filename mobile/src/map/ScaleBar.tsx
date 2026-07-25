// Scale bar drawn in JS (MapLibre RN v10 ships no scale-bar ornament). Sits
// along the bottom edge of the map, spanning the width left of the floating
// button column. Classic cartographic form: label above a capped rule.
import { StyleSheet, Text, View } from "react-native";

import { fontSize, fontWeight, radius, spacing, theme } from "../theme";
import { chooseScaleStep, metersPerPixel } from "./scaleBar";

export function ScaleBar({
  latitude,
  zoom,
  maxWidth,
}: {
  latitude: number;
  zoom: number;
  /** Horizontal space the bar may occupy, in px. */
  maxWidth: number;
}) {
  // Guard the degenerate first frame (zero-width layout) rather than letting
  // chooseScaleStep throw during mount.
  if (maxWidth <= 0) return null;
  const step = chooseScaleStep(metersPerPixel(latitude, zoom), maxWidth);

  return (
    <View style={styles.root} pointerEvents="none">
      <Text style={styles.label}>{step.label}</Text>
      <View style={[styles.rule, { width: step.widthPx }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  // Translucent warm backing: the bar sits over map imagery that can be any
  // brightness, and hairlines over topo raster are otherwise unreadable.
  root: {
    alignSelf: "flex-start",
    alignItems: "flex-start",
    backgroundColor: `${theme.primary}CC`,
    borderRadius: radius.sm,
    paddingHorizontal: spacing(0.75),
    paddingTop: spacing(0.25),
    paddingBottom: spacing(0.5),
    gap: spacing(0.25),
  },
  label: {
    color: theme.textPrimary,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
  },
  // Capped rule: bottom edge plus down-turned ends.
  rule: {
    height: 6,
    borderColor: theme.textPrimary,
    borderLeftWidth: 2,
    borderRightWidth: 2,
    borderBottomWidth: 2,
    borderBottomLeftRadius: 1,
    borderBottomRightRadius: 1,
  },
});
