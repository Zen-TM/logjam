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
import { StyleSheet, View } from "react-native";
import {
  LineLayer,
  PointAnnotation,
  ShapeSource,
  SymbolLayer,
  type SymbolLayerStyle,
} from "@maplibre/maplibre-react-native";
import type { RoutePoint } from "@logjam/shared";

import { theme, withAlpha } from "../theme";

/** Below this a route is a few pixels of line and arrows on it are just noise. */
export const ROUTE_ARROW_MIN_ZOOM = 12;

const ARROW_GLYPH = "\u203A";

/**
 * Which way the line runs, as arrows along it — MapLibre spaces and rotates
 * them itself, so they re-space as you zoom and cost no React views (the
 * markers this replaced were re-created on every drag frame, which is what made
 * dragging an anchor stutter).
 *
 * A STYLE, not a component of ours, and two things here are load-bearing:
 *
 * - The layer has to be a DIRECT child of its `ShapeSource`. MLRN injects
 *   `sourceID` onto the source's immediate children with `cloneElement`, so a
 *   layer wrapped in a component of ours never learns which source it belongs
 *   to, falls back to the default source id and draws nothing.
 * - `textFont` has to name a stack we actually ship. The bundled glyph pack
 *   (Protomaps basemap-assets, see `basemapAssets.ts`) carries Noto Sans only,
 *   while MapLibre's default fontstack is Open Sans — a symbol layer that omits
 *   the font asks for glyphs that 404 and renders no text at all, silently.
 *   Every other SymbolLayer in the app names this same stack.
 *
 * Overlap allowed and placement ignored so an arrow never loses a contest with
 * a street label, and `textKeepUpright` off because an arrow that flips itself
 * to stay readable is then pointing the wrong way.
 */
export function routeArrowStyle(
  color: SymbolLayerStyle["textColor"],
  spacing = 90,
): SymbolLayerStyle {
  return {
    symbolPlacement: "line",
    symbolSpacing: spacing,
    textField: ARROW_GLYPH,
    textFont: ["Noto Sans Medium"],
    textSize: 18,
    textColor: color,
    textHaloColor: theme.primary,
    textHaloWidth: 1,
    textAllowOverlap: true,
    textIgnorePlacement: true,
    textKeepUpright: false,
    textRotationAlignment: "map",
    textPitchAlignment: "map",
  };
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
          <SymbolLayer
            id={`${idPrefix}-line-arrows`}
            minZoomLevel={ROUTE_ARROW_MIN_ZOOM}
            style={routeArrowStyle(theme.accent)}
          />
        </ShapeSource>
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
});
