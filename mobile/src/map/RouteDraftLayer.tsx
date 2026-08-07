// The line a map tool is drawing, and the handles for its anchors.
//
// Shared by route draw and measure — they are the same interaction, and the
// only thing that differs here is the ink: a route is SOLID (a thing you are
// making), a measurement is DOTTED (a ruler laid over the map, a thing you are
// asking). Keeping the two visually distinct is how you tell at a glance which
// tool has the taps.
//
// Unpinned (no layerIndex) so it sits above every overlay — a line you can't
// see under a topo layer is useless.
import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  LineLayer,
  MarkerView,
  PointAnnotation,
  ShapeSource,
} from "@maplibre/maplibre-react-native";
import type { RoutePoint } from "@logjam/shared";

import { theme, withAlpha } from "../theme";
import { routeArrows } from "./routeArrows";

/**
 * Which way the line runs, as arrows along it.
 *
 * MarkerViews rather than a SymbolLayer: the declarative version renders
 * nothing at all in this MapLibre React Native setup (see routeArrows.ts for
 * what was ruled out on device). MarkerView is the same mechanism the anchor
 * handles already use, so it is known to work here.
 *
 * Deliberately few and non-interactive — `allowOverlap` so they never lose a
 * placement contest with a street label, and no press handler so a tap that
 * lands on one still reaches the route beneath it.
 */
const ARROW_GLYPH = "\u203A";

export function RouteDirectionArrows({
  points,
  color,
  count,
}: {
  points: readonly RoutePoint[];
  color: string;
  count?: number;
}) {
  const arrows = useMemo(() => routeArrows(points, count), [points, count]);
  return (
    <>
      {arrows.map((arrow, index) => (
        <MarkerView
          key={`arrow-${index}`}
          coordinate={arrow.coordinate as number[]}
          allowOverlap
          anchor={{ x: 0.5, y: 0.5 }}
        >
          {/* The glyph points east at 0deg, so it is rotated to the bearing
              minus a quarter turn. */}
          <View
            style={[
              styles.arrow,
              { transform: [{ rotate: `${arrow.bearing - 90}deg` }] },
            ]}
            pointerEvents="none"
          >
            <Text style={[styles.arrowGlyph, { color }]}>{ARROW_GLYPH}</Text>
          </View>
        </MarkerView>
      ))}
    </>
  );
}

export function RouteDraftLayer({
  idPrefix,
  points,
  anchors,
  dotted,
  onAnchorDragStart,
  onAnchorDrag,
  onAnchorDragEnd,
  onAnchorPress,
}: {
  idPrefix: string;
  /** Full geometry — anchors plus whatever snapping filled in between them. */
  points: readonly RoutePoint[];
  /** The user's own vertices, which are the only draggable things. */
  anchors: readonly RoutePoint[];
  dotted: boolean;
  onAnchorDragStart: (index: number) => void;
  onAnchorDrag: (index: number, point: RoutePoint) => void;
  onAnchorDragEnd: (index: number, point: RoutePoint) => void;
  onAnchorPress: (index: number) => void;
}) {
  const last = anchors.length - 1;
  return (
    <>
      {points.length >= 2 ? (
        <ShapeSource
          id={`${idPrefix}-line`}
          shape={{
            type: "Feature",
            geometry: {
              type: "LineString",
              coordinates: points.map((point) => [...point]),
            },
            properties: {},
          }}
        >
          <LineLayer
            id={`${idPrefix}-line-stroke`}
            style={{
              lineColor: theme.accent,
              lineWidth: 3,
              lineCap: "round",
              lineJoin: "round",
              ...(dotted ? { lineDasharray: [1, 1.5] } : {}),
            }}
          />
        </ShapeSource>
      ) : null}

      {points.length >= 2 ? (
        <RouteDirectionArrows points={points} color={theme.accent} />
      ) : null}

      {/* One handle per ANCHOR — never per point. A snapped run is geometry the
          tool produced, not vertices the user placed, so dotting every one of
          them made 500 m of creek look like twenty-two decisions.
          PointAnnotation rather than a CircleLayer because it is the only thing
          in the wrapper that can be dragged. */}
      {anchors.map((anchor, index) => (
        <PointAnnotation
          key={`${idPrefix}-anchor-${index}`}
          id={`${idPrefix}-anchor-${index}`}
          coordinate={anchor as number[]}
          draggable
          onDragStart={() => onAnchorDragStart(index)}
          onDrag={(payload: { geometry?: { coordinates?: number[] } }) => {
            const moved = payload.geometry?.coordinates as RoutePoint | undefined;
            if (moved) onAnchorDrag(index, moved);
          }}
          onDragEnd={(payload: { geometry?: { coordinates?: number[] } }) => {
            const moved = payload.geometry?.coordinates as RoutePoint | undefined;
            if (moved) onAnchorDragEnd(index, moved);
          }}
          onSelected={() => onAnchorPress(index)}
        >
          {/* Ends are marked, not badged: the first anchor is filled and the
              last is hollow, which says which way the line runs up close
              without adding a second thing to read at a glance. */}
          <View
            style={[
              styles.anchor,
              index === 0 ? styles.anchorStart : null,
              index === last && last > 0 ? styles.anchorEnd : null,
            ]}
          />
        </PointAnnotation>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  // Bigger than it looks: the visible dot is 16px but the annotation's touch
  // target is the whole view, and a 16px target is unhittable with a thumb.
  anchor: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: withAlpha(theme.accent, 0.25),
    borderWidth: 2,
    borderColor: theme.accent,
  },
  anchorStart: { backgroundColor: theme.accent },
  anchorEnd: { backgroundColor: withAlpha(theme.primary, 0.85) },
  arrow: { alignItems: "center", justifyContent: "center", width: 18, height: 18 },
  arrowGlyph: {
    fontSize: 18,
    fontWeight: "700",
    // A halo the cheap way: the glyph sits on the line it describes, and
    // without a light edge it disappears into it.
    textShadowColor: theme.primary,
    textShadowRadius: 2,
    textShadowOffset: { width: 0, height: 0 },
    lineHeight: 18,
  },
});
