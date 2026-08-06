// Saved routes, drawn from the MIRROR.
//
// Unlike CanyonRoutesLayer (which parses GPX/KML out of the media cache and can
// only draw what this phone has fetched), a route's geometry is a column on the
// synced row — so there is nothing to fetch, nothing to parse, and no
// "unavailable" count to report. It works offline the moment the delta lands.
//
// ONE ShapeSource for the same reason as CanyonRoutesLayer: per-feature colour
// via a data-driven style beats N native sources.
import { useMemo } from "react";
import { CircleLayer, LineLayer, ShapeSource } from "@maplibre/maplibre-react-native";

import { theme } from "../theme";
import type { MirrorRoute } from "../sync/mirrorStore";

/** Colour for a route whose server-assigned palette entry hasn't arrived yet
 * (drawn offline, create still queued). */
const UNSYNCED_ROUTE_COLOR = theme.accent;

export function RoutesLayer({
  routes,
  /** Hidden while its geometry is being edited — the draft layer draws it. */
  hiddenRouteId,
}: {
  routes: readonly MirrorRoute[];
  hiddenRouteId: string | null;
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
    <ShapeSource id="saved-routes" shape={shape}>
      {/* Casing first: a dark under-stroke keeps a mid-tone line legible over
          both the pale basemap and dark imagery. */}
      <LineLayer
        id="saved-routes-casing"
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
        style={{
          lineColor: ["get", "routeColor"],
          lineWidth: 3,
          lineCap: "round",
          lineJoin: "round",
        }}
      />
      <CircleLayer
        id="saved-routes-ends"
        filter={["==", ["geometry-type"], "Point"]}
        style={{
          circleRadius: 4,
          circleColor: ["get", "routeColor"],
          circleStrokeWidth: 1.5,
          circleStrokeColor: theme.primary,
        }}
      />
    </ShapeSource>
  );
}
