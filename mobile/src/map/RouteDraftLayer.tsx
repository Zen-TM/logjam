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
import { useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import {
  GeoJSONSource,
  Layer,
  ViewAnnotation,
  type ViewAnnotationEvent,
} from "@maplibre/maplibre-react-native";
import type { NativeSyntheticEvent } from "react-native";
import {
  draftPoints,
  moveAnchor,
  type RouteDraft,
  type RoutePoint,
} from "@logjam/shared";

import { dragIsTap } from "./anchorHit";
import {
  ARROW_LAYER_FILTER,
  ROUTE_ARROW_MIN_ZOOM,
  ROUTE_LAYER_FILTER,
  arrowSegmentFeatures,
  routeArrowStyle,
} from "./routeArrowStyle";
import { theme } from "../theme";

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
 *
 * SELECTION rides in the same expression for the same reason: a selected anchor
 * is a bigger dot with a light ring, driven by a `selected` property per
 * feature, so picking and un-picking one repaints immediately and costs no new
 * view. A selected anchor takes the WARNING fill on top of the size and ring:
 * a middle anchor's own fill is near-white and a middle anchor's ring is the
 * accent, so a size-only change is the one variation that has to read on all
 * three roles at arm's length. It matches the one verb the selection offers.
 */
const ANCHOR_RADIUS_END = 7;
const ANCHOR_RADIUS_MIDDLE = 5;
const ANCHOR_RADIUS_SELECTED = 10;

const EMPTY_LINE_FEATURE: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

const EMPTY_ANCHOR_FEATURES: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

function anchorFeatures(
  anchors: readonly RoutePoint[],
  selectedIndex: number | null,
): GeoJSON.FeatureCollection {
  const last = anchors.length - 1;
  return {
    type: "FeatureCollection",
    features: anchors.map((anchor, index) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [...anchor] },
      properties: {
        role: index === 0 ? "start" : index === last && last > 0 ? "end" : "middle",
        selected: index === selectedIndex,
      },
    })),
  };
}

export function RouteDraftLayer({
  idPrefix,
  draft,
  dotted,
  degreesPerDp,
  color = theme.accent,
  selectedIndex = null,
  onAnchorDrag,
  onAnchorDragEnd,
  onAnchorPress,
  onDragActiveChange,
}: {
  idPrefix: string;
  /** The draft itself — anchors AND the snapped filler between them. */
  draft: RouteDraft;
  dotted: boolean;
  /** The current zoom's ground scale, for telling a tap from a drag — see
   *  `dragIsTap`. Passed in because the camera lives on the screen. */
  degreesPerDp: number;
  /** The ink for the line being drawn. The route tool passes the colour the
   *  draft will SAVE with, so picking one shows up immediately rather than at
   *  the next reload; measure has no colour and draws in the accent. */
  color?: string;
  /** The anchor the user has tapped, drawn picked out. Null when none is. */
  selectedIndex?: number | null;
  onAnchorDrag: (index: number, point: RoutePoint) => void;
  onAnchorDragEnd: (index: number, point: RoutePoint) => void;
  /** The screen x of the press, in dp, when the gesture carried one — see
   *  `selectedSide`. */
  onAnchorPress: (index: number, screenXDp: number | null) => void;
  /**
   * A real drag started, or the one in flight ended. The caller hides the
   * selected anchor's delete button for the length of it — a button pinned to
   * a point that is moving under the finger chases it across the map, and it
   * sits exactly where the finger is going. Reported on the SLOP CROSSING, not
   * on `onDragStart`, so a tap that arrives through the drag callbacks never
   * flickers it.
   */
  onDragActiveChange?: (dragging: boolean) => void;
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

  /**
   * Whether the gesture in progress has travelled far enough to BE a drag.
   *
   * A tap on a draggable annotation arrives as a drag of a pixel or two, and
   * committing that moved the anchor a metre or two and selected nothing —
   * which is what made deleting a point feel impossible. Below the slop the
   * gesture is forwarded as a PRESS instead and the anchor does not move at
   * all. Once past the slop it stays a drag for the rest of the gesture, so a
   * finger that wanders out and comes back still commits (the alternative
   * leaves the preview showing a move nothing wrote).
   *
   * A ref, not state: it must be readable in the same event that sets it, and
   * nothing draws from it.
   */
  const dragBeyondSlop = useRef(false);

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
  const previewPoints = draftPoints(preview);
  const anchors = preview.anchors;
  const lineData: GeoJSON.FeatureCollection = useMemo(
    () =>
      previewPoints.length >= 2
        ? {
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                geometry: {
                  type: "LineString",
                  coordinates: previewPoints.map((point) => [...point]),
                },
                properties: {},
              },
              // Drawn by the arrow layer alone: one line per segment is what
              // keeps an arrow off the anchor handle you are about to drag.
              ...arrowSegmentFeatures(previewPoints, {}),
            ],
          }
        : EMPTY_LINE_FEATURE,
    [previewPoints],
  );

  const anchorData: GeoJSON.FeatureCollection = useMemo(
    () =>
      anchors.length > 0
        ? anchorFeatures(anchors, selectedIndex)
        : EMPTY_ANCHOR_FEATURES,
    [anchors, selectedIndex],
  );

  return (
    <>
      <GeoJSONSource id={`${idPrefix}-line`} data={lineData}>
        <Layer
          key={`${idPrefix}-line-stroke`}
          type="line"
          id={`${idPrefix}-line-stroke`}
          filter={ROUTE_LAYER_FILTER}
          style={{
            lineColor: color,
            lineWidth: 3,
            lineCap: "round",
            lineJoin: "round",
            ...(dotted ? { lineDasharray: [1, 1.5] } : {}),
          }}
        />
        <Layer
          key={`${idPrefix}-line-arrows`}
          type="symbol"
          id={`${idPrefix}-line-arrows`}
          minzoom={ROUTE_ARROW_MIN_ZOOM}
          filter={ARROW_LAYER_FILTER}
          style={routeArrowStyle(color)}
        />
      </GeoJSONSource>

      {/* Declared after the line, so it always paints above it in MapLibre. */}
      <GeoJSONSource id={`${idPrefix}-anchors`} data={anchorData}>
        <Layer
          key={`${idPrefix}-anchor-dots`}
          type="circle"
          id={`${idPrefix}-anchor-dots`}
          style={{
            circleRadius: [
              "case",
              ["get", "selected"],
              ANCHOR_RADIUS_SELECTED,
              [
                "match",
                ["get", "role"],
                "middle",
                ANCHOR_RADIUS_MIDDLE,
                ANCHOR_RADIUS_END,
              ],
            ],
            // The ROUTE'S colour, not the accent: a line drawn in green with
            // orange dots on it reads as two things overlaid. Only the roles
            // stay fixed — the start is filled with the line's colour, the
            // end stays dark, the middles stay pale — so which end is which
            // survives every palette choice.
            circleColor: [
              "case",
              ["get", "selected"],
              theme.warning,
              [
                "match",
                ["get", "role"],
                "start",
                color,
                "end",
                theme.primary,
                theme.textPrimary,
              ],
            ],
            circleStrokeWidth: ["case", ["get", "selected"], 3, 2],
            // Selected keeps the light ring and the warning fill rather than
            // the route's colour: it has to stay legible against all ten of
            // TRACK_COLORS, including the pale ones.
            circleStrokeColor: [
              "case",
              ["get", "selected"],
              theme.textPrimary,
              color,
            ],
          }}
        />
      </GeoJSONSource>

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
            dragBeyondSlop.current = false;
          }}
          onDrag={(event: NativeSyntheticEvent<ViewAnnotationEvent>) => {
            const moved = event.nativeEvent.lngLat as RoutePoint | undefined;
            if (!moved) return;
            if (!dragBeyondSlop.current && dragIsTap(anchor, moved, degreesPerDp)) {
              return;
            }
            if (!dragBeyondSlop.current) onDragActiveChange?.(true);
            dragBeyondSlop.current = true;
            setDrag({ index, point: moved });
            onAnchorDrag(index, moved);
          }}
          onDragEnd={(event: NativeSyntheticEvent<ViewAnnotationEvent>) => {
            const moved = event.nativeEvent.lngLat as RoutePoint | undefined;
            // The drop is re-measured against the origin as well as trusting
            // the per-frame flag, so a gesture that somehow delivers no drag
            // frames is still committed if it actually went somewhere.
            const wasDrag =
              dragBeyondSlop.current ||
              (moved != null && !dragIsTap(anchor, moved, degreesPerDp));
            setDrag(null);
            if (dragBeyondSlop.current) onDragActiveChange?.(false);
            if (!wasDrag) {
              // Never moved: this was a tap that happened to arrive through the
              // drag callbacks. Nothing is committed and nothing is snapped.
              onAnchorPress(index, event.nativeEvent.point?.[0] ?? null);
              return;
            }
            if (moved) onAnchorDragEnd(index, moved);
          }}
          // `onPress`, NOT `onSelect`: the native side fires onSelect only on
          // the false->true transition and then leaves the annotation selected
          // (nothing here ever deselects it), so a second tap on the same
          // anchor fired nothing at all — one of the reasons the delete verb
          // was unreachable. onPress fires on every tap
          // (MLRNPointAnnotation.kt).
          onPress={(event: NativeSyntheticEvent<ViewAnnotationEvent>) =>
            onAnchorPress(index, event.nativeEvent.point?.[0] ?? null)
          }
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
