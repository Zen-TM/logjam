// Scale bar drawn in JS (MapLibre RN v10 ships no scale-bar ornament — it
// exposes compass, attribution and logo only). Sits along the bottom-left edge
// of the map, under the native compass.
//
// It updates IMPERATIVELY, through a ref, rather than from props. The bar has
// to follow the camera continuously to be worth having — a bar that only
// redraws once a gesture settles is wrong for the whole duration of every pan —
// and `onRegionIsChanging` fires at gesture rate. Routing that through the map
// screen's state would re-reconcile every layer, source and badge on the screen
// at 60 Hz; this way the only thing that re-renders is the bar.
import { forwardRef, useImperativeHandle, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { fontSize, fontWeight, radius, spacing, theme } from "../theme";
import { chooseScaleStep, metersPerPixel } from "./scaleBar";

export type ScaleBarHandle = { update: (latitude: number, zoom: number) => void };

export const ScaleBar = forwardRef<
  ScaleBarHandle,
  {
    latitude: number;
    zoom: number;
    /** Horizontal space the bar may occupy, in px. */
    maxWidth: number;
  }
>(function ScaleBar({ latitude, zoom, maxWidth }, ref) {
  const [camera, setCamera] = useState({ latitude, zoom });

  useImperativeHandle(ref, () => ({
    update: (nextLatitude: number, nextZoom: number) => {
      if (!Number.isFinite(nextLatitude) || !Number.isFinite(nextZoom)) return;
      setCamera((current) =>
        current.latitude === nextLatitude && current.zoom === nextZoom
          ? current
          : { latitude: nextLatitude, zoom: nextZoom },
      );
    },
  }));

  // Guard the degenerate first frame (zero-width layout) rather than letting
  // chooseScaleStep throw during mount.
  if (maxWidth <= 0) return null;
  const step = chooseScaleStep(metersPerPixel(camera.latitude, camera.zoom), maxWidth);

  return (
    <View style={styles.root} pointerEvents="none">
      <Text style={styles.label}>{step.label}</Text>
      <View style={[styles.rule, { width: step.widthPx }]} />
    </View>
  );
});

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
