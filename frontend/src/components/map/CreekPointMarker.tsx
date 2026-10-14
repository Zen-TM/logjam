import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import * as maplibregl from "maplibre-gl";
import type { MapPointCoord } from "@logjam/shared";
import { MapCreekPoint, MapFlowArrow } from "../../ui";
import { passThrough } from "./markerElement";

/**
 * The creek point a catchment was measured at, as a water drop, with an arrow
 * on the side the water runs to when the API knows (`downstreamBearing`).
 *
 * Two markers rather than one rotated: the drop stays upright whatever the
 * map's bearing, while the arrow turns with the map (`rotationAlignment:
 * "map"`), so it keeps pointing down the creek as the map is rotated.
 */
export function CreekPointMarker({
  map,
  point,
  bearing,
}: {
  map: maplibregl.Map;
  point: MapPointCoord;
  /** Degrees clockwise from north; no arrow without it. */
  bearing?: number;
}) {
  const [dropEl] = useState(passThrough);
  const [arrowEl] = useState(passThrough);
  const hasArrow = bearing != null && Number.isFinite(bearing);

  useEffect(() => {
    const at: [number, number] = [point.longitude, point.latitude];
    // The arrow first, so the drop stands over its box.
    const arrow = hasArrow
      ? new maplibregl.Marker({
          element: arrowEl,
          rotation: bearing,
          rotationAlignment: "map",
        })
          .setLngLat(at)
          .addTo(map)
      : null;
    // The round of the drop on the point, not the middle of its box.
    const drop = new maplibregl.Marker({ element: dropEl, offset: [0, -3] })
      .setLngLat(at)
      .addTo(map);
    return () => {
      drop.remove();
      arrow?.remove();
    };
  }, [map, point, bearing, hasArrow, dropEl, arrowEl]);

  return (
    <>
      {createPortal(<MapCreekPoint />, dropEl)}
      {hasArrow && createPortal(<MapFlowArrow />, arrowEl)}
    </>
  );
}
