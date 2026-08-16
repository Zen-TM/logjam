// Saved routes, drawn from the MIRROR.
//
// Unlike CanyonRoutesLayer (which parses GPX/KML out of the media cache and can
// only draw what this phone has fetched), a route's geometry is a column on the
// synced row — so there is nothing to fetch, nothing to parse, and no
// "unavailable" count to report. It works offline the moment the delta lands.
//
// ONE ShapeSource for the same reason as CanyonRoutesLayer: per-feature colour
// via a data-driven style beats N native sources.
import { memo, useMemo } from "react";
import {
  CircleLayer,
  LineLayer,
  ShapeSource,
  SymbolLayer,
} from "@maplibre/maplibre-react-native";

import { theme } from "../theme";
import type { MirrorRoute } from "../sync/mirrorStore";
import { ROUTE_ARROW_MIN_ZOOM, routeArrowStyle } from "./RouteDraftLayer";

/**
 * Zoom floor for SAVED routes. Zoomed out past this a route is a few pixels of
 * line that says nothing about where it goes, and a state-wide view of every
 * route you have ever drawn is just ink over the map.
 *
 * Matches the web's ROUTE_MIN_ZOOM — roughly a 50 km view. The route being DRAWN is exempt (the draft
 * layer has no floor) — hiding what the user is working on would be absurd.
 */
export const SAVED_ROUTE_MIN_ZOOM = 10;

/** Colour for a route whose server-assigned palette entry hasn't arrived yet
 * (drawn offline, create still queued). */
const UNSYNCED_ROUTE_COLOR = theme.accent;

export const RoutesLayer = memo(function RoutesLayer({
  routes,
  /** Hidden while its geometry is being edited — the draft layer draws it. */
  hiddenRouteId,
  onPressRoute,
}: {
  routes: readonly MirrorRoute[];
  hiddenRouteId: string | null;
  /** Tapping a line opens its stats. Absent while a tool owns the map's taps. */
  onPressRoute?: (routeId: string) => void;
}) {
  const shape = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: routes
        .filter((route) => route.id !== hiddenRouteId && route.points.length >= 2)
        .map((route) => ({
          type: "Feature" as const,
          geometry: {
            type: "LineString" as const,
            coordinates: route.points as number[][],
          },
          properties: {
            routeId: route.id,
            routeColor: route.color ?? UNSYNCED_ROUTE_COLOR,
          },
        })),
    }),
    [routes, hiddenRouteId],
  );

  if (shape.features.length === 0) return null;

  return (
    <ShapeSource
      id="saved-routes"
      shape={shape}
      // A 3px line is far thinner than a fingertip; the hitbox is what makes
      // tapping one a reasonable thing to ask. 44pt is the platform minimum
      // touch target, and it is the right number here for the same reason.
      hitbox={{ width: 44, height: 44 }}
      onPress={
        onPressRoute &&
        ((event) => {
          const routeId = event.features[0]?.properties?.routeId;
          if (typeof routeId === "string") onPressRoute(routeId);
        })
      }
    >
      {/* Casing first: a dark under-stroke keeps a mid-tone line legible over
          both the pale basemap and dark imagery. */}
      <LineLayer
        id="saved-routes-casing"
        minZoomLevel={SAVED_ROUTE_MIN_ZOOM}
        style={{
          lineColor: theme.primary,
          lineWidth: 6,
          lineCap: "round",
          lineJoin: "round",
          lineOpacity: 0.7,
        }}
      />
      <LineLayer
        id="saved-routes-line"
        minZoomLevel={SAVED_ROUTE_MIN_ZOOM}
        style={{
          lineColor: ["get", "routeColor"],
          lineWidth: 3,
          lineCap: "round",
          lineJoin: "round",
        }}
      />
      <CircleLayer
        id="saved-routes-ends"
        minZoomLevel={SAVED_ROUTE_MIN_ZOOM}
        filter={["==", ["geometry-type"], "Point"]}
        style={{
          circleRadius: 4,
          circleColor: ["get", "routeColor"],
          circleStrokeWidth: 1.5,
          circleStrokeColor: theme.primary,
        }}
      />
      {/* Spaced wider than the draft's: several routes on screen at once is a
          lot of chevrons, and here they only answer "which way does this run".
          Colour is data-driven, so all of them are still one native layer. */}
      <SymbolLayer
        id="saved-routes-arrows"
        minZoomLevel={ROUTE_ARROW_MIN_ZOOM}
        style={routeArrowStyle(["get", "routeColor"], 140)}
      />
    </ShapeSource>
  );
});
