import { useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import * as maplibregl from "maplibre-gl";
import type { MapPointCoord } from "@logjam/shared";
import { MapPointDot } from "../../ui";

/**
 * The dot left at a point a panel asks or offers about, and the element that
 * panel anchors to: a marker, so both stay on the point while the map moves.
 *
 * Render it BEFORE the panel. Layout effects run in tree order, and the panel
 * reads where its anchor is in its own: with the marker added later (a plain
 * effect, or a parent's) the anchor is still unplaced at the first paint, and
 * the panel opens in the top left until something resizes it.
 */
export function PointAnchor({
  map,
  point,
  element,
  onClose,
}: {
  map: maplibregl.Map;
  point: MapPointCoord;
  element: HTMLElement;
  onClose: () => void;
}) {
  useLayoutEffect(() => {
    const marker = new maplibregl.Marker({ element })
      .setLngLat([point.longitude, point.latitude])
      .addTo(map);
    // The point stays put while the map moves, so the panel would be left
    // beside nothing: moving the map is looking away.
    map.on("movestart", onClose);
    return () => {
      map.off("movestart", onClose);
      marker.remove();
    };
  }, [map, point, element, onClose]);
  return createPortal(<MapPointDot />, element);
}
