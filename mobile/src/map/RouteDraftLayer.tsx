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
import { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import {
  GeoJSONSource,
  Layer,
  ViewAnnotation,
  type SymbolLayerStyle,
  type ViewAnnotationEvent,
} from "@maplibre/maplibre-react-native";
import type { NativeSyntheticEvent } from "react-native";
import {
  draftPoints,
  moveAnchor,
  type RouteDraft,
  type RoutePoint,
} from "@logjam/shared";

import { theme } from "../theme";

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
 * - The layer has to be a DIRECT child of its `GeoJSONSource`. MLRN injects
 *   `source` onto the source's immediate children with `cloneElement`, so a
 *   layer wrapped in a component of ours never learns which source it belongs
 *   to, falls back to the default source id and draws nothing.
 * - `textFont` has to name a stack we actually ship. The bundled glyph pack
 *   (Protomaps basemap-assets, see `basemapAssets.ts`) carries Noto Sans only,
 *   while MapLibre's default fontstack is Open Sans — a symbol layer that omits
 *   the font asks for glyphs that 404 and renders no text at all, silently.
 *   Every other symbol layer in the app names this same stack.
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

/**
 * Anchor sizes and fills.
 *
 * The ends are marked, the middles recede: a middle anchor is a small white dot
 * (a handle), the first is filled accent and the last is dark. Everything is
 * drawn by a circle layer rather than by the annotation's own child view for two
 * reasons — a native layer declared AFTER the line always paints above it, and
 * its styling is data-driven, so an anchor that stops being the last one
 * changes appearance immediately. A ViewAnnotation's child view does neither:
 * MLRN rasterises it once, so the old last-anchor kept its dark fill until the
 * draft was reopened.
 */
const ANCHOR_RADIUS_END = 7;
const ANCHOR_RADIUS_MIDDLE = 5;

function anchorFeatures(
  anchors: readonly RoutePoint[],
): GeoJSON.FeatureCollection {
  const last = anchors.length - 1;
  return {
    type: "FeatureCollection",
    features: anchors.map((anchor, index) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [...anchor] },
      properties: {
        role: index === 0 ? "start" : index === last && last > 0 ? "end" : "middle",
      },
    })),
  };
}

export function RouteDraftLayer({
  idPrefix,
  draft,
  dotted,
  onAnchorDragStart,
  onAnchorDrag,
  onAnchorDragEnd,
  onAnchorPress,
}: {
  idPrefix: string;
  /** The draft itself — anchors AND the snapped filler between them. */
  draft: RouteDraft;
  dotted: boolean;
  onAnchorDragStart: (index: number) => void;
  onAnchorDrag: (index: number, point: RoutePoint) => void;
  onAnchorDragEnd: (index: number, point: RoutePoint) => void;
  onAnchorPress: (index: number) => void;
}) {
  /**
   * The anchor being dragged, held HERE rather than in the screen's state.
   *
   * Routing every drag frame up to MapScreen re-rendered the whole map screen
   * per frame, and the line visibly lagged the finger. Keeping it local means
   * only this component re-renders, so the geometry keeps up.
   */
  const [drag, setDrag] = useState<{ index: number; point: RoutePoint } | null>(
    null,
  );

  // The draft as it should look right now: the committed draft with the drag
  // applied through `moveAnchor` — the SAME helper the drop commits through, so
  // the preview cannot disagree with the result.
  //
  // Passing the real draft matters: an earlier version built a throwaway draft
  // with no filler, which straightened the WHOLE route while one anchor moved.
  // moveAnchor clears only the two runs either side of the anchor, which is
  // exactly the pair that gets re-snapped on the drop.
  const preview = useMemo(
    () => (drag ? moveAnchor(draft, drag.index, drag.point) : draft),
    [draft, drag],
  );
  const previewPoints = useMemo(() => draftPoints(preview), [preview]);
  const anchors = preview.anchors;

  return (
    <>
      {previewPoints.length >= 2 ? (
        <GeoJSONSource
          id={`${idPrefix}-line`}
          data={{
            type: "Feature",
            geometry: {
              type: "LineString",
              coordinates: previewPoints.map((point) => [...point]),
            },
            properties: {},
          }}
        >
          <Layer
            type="line"
            id={`${idPrefix}-line-stroke`}
            style={{
              lineColor: theme.accent,
              lineWidth: 3,
              lineCap: "round",
              lineJoin: "round",
              ...(dotted ? { lineDasharray: [1, 1.5] } : {}),
            }}
          />
          <Layer
            type="symbol"
            id={`${idPrefix}-line-arrows`}
            minzoom={ROUTE_ARROW_MIN_ZOOM}
            style={routeArrowStyle(theme.accent)}
          />
        </GeoJSONSource>
      ) : null}

      {/* Declared after the line, so it paints above it. */}
      {anchors.length > 0 ? (
        <GeoJSONSource id={`${idPrefix}-anchors`} data={anchorFeatures(anchors)}>
          <Layer
            type="circle"
            id={`${idPrefix}-anchor-dots`}
            style={{
              circleRadius: [
                "match",
                ["get", "role"],
                "middle",
                ANCHOR_RADIUS_MIDDLE,
                ANCHOR_RADIUS_END,
              ],
              circleColor: [
                "match",
                ["get", "role"],
                "start",
                theme.accent,
                "end",
                theme.primary,
                theme.textPrimary,
              ],
              circleStrokeWidth: 2,
              circleStrokeColor: theme.accent,
            }}
          />
        </GeoJSONSource>
      ) : null}

      {/* One INVISIBLE handle per anchor — never per point. A snapped run is
          geometry the tool produced, not vertices the user placed, so dotting
          every one of them made 500 m of creek look like twenty-two decisions.
          ViewAnnotation is the only thing in the wrapper that can be dragged;
          it carries no visuals now, just the touch target. */}
      {draft.anchors.map((anchor, index) => (
        <ViewAnnotation
          key={`${idPrefix}-anchor-${index}`}
          id={`${idPrefix}-anchor-${index}`}
          lngLat={anchor as [number, number]}
          draggable
          onDragStart={() => {
            setDrag({ index, point: anchor });
            onAnchorDragStart(index);
          }}
          onDrag={(event: NativeSyntheticEvent<ViewAnnotationEvent>) => {
            const moved = event.nativeEvent.lngLat as RoutePoint | undefined;
            if (!moved) return;
            setDrag({ index, point: moved });
            onAnchorDrag(index, moved);
          }}
          onDragEnd={(event: NativeSyntheticEvent<ViewAnnotationEvent>) => {
            const moved = event.nativeEvent.lngLat as RoutePoint | undefined;
            setDrag(null);
            if (moved) onAnchorDragEnd(index, moved);
          }}
          onSelect={() => onAnchorPress(index)}
        >
          <View style={styles.handle} />
        </ViewAnnotation>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  // Invisible, and deliberately far bigger than the dot it grabs: the visible
  // anchor is ~14px and a 14px touch target is unhittable with a thumb.
  //
  // The alpha is 0.01 rather than 0: MLRN rasterises the child view, and a
  // fully empty bitmap makes it fall back to its own red default pin. One
  // percent of a colour is a bitmap.
  handle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(255,255,255,0.01)",
  },
});
