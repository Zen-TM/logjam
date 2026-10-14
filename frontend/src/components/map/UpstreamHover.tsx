import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import * as maplibregl from "maplibre-gl";
import { formatCatchmentKm2 } from "@logjam/shared";
import { MapTip } from "../../ui";
import { passThrough } from "./markerElement";
import { UPSTREAM_LINE_LAYERS } from "./flowNetworkLayers";

/** A hairline is under a pixel wide: the pointer gets this much slack. */
const HIT_SLOP_PX = 4;

/**
 * Pointing at one of the creeks upstream shows the land that creek drains,
 * in a tip that follows the pointer. Hover only: it adds to what is drawn and
 * takes nothing, so a press there still asks "What is here?" and a pin there
 * still opens. The tip moves as a marker, never as state above the map
 * (frontend/DESIGN.md §4, Performance); only its words are state, and they
 * change only when the pointer crosses onto another creek.
 */
export function UpstreamHover({
  map,
  pressable,
  armed,
}: {
  map: maplibregl.Map;
  /** Layers with a press of their own: over one, the pin's cursor wins. */
  pressable: readonly string[];
  /** A drawing tool or a pick owns the pointer and its cursor. */
  armed: () => boolean;
}) {
  const [el] = useState(passThrough);
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    const marker = new maplibregl.Marker({
      element: el,
      anchor: "bottom-left",
      offset: [12, -8],
    });
    const canvas = map.getCanvas();
    let shown = false;
    // `keepCursor`: something else under the pointer set it.
    const hide = (keepCursor = false) => {
      if (!shown) return;
      shown = false;
      marker.remove();
      if (!keepCursor) canvas.style.cursor = "";
      setLabel(null);
    };
    const onMove = (event: maplibregl.MapMouseEvent) => {
      if (armed()) {
        hide(true);
        return;
      }
      const onPin = pressable.filter((id) => map.getLayer(id));
      if (
        onPin.length &&
        map.queryRenderedFeatures(event.point, { layers: onPin }).length
      ) {
        hide(true);
        return;
      }
      const layers = UPSTREAM_LINE_LAYERS.filter((id) => map.getLayer(id));
      const { x, y } = event.point;
      const hit = layers.length
        ? map.queryRenderedFeatures(
            [
              [x - HIT_SLOP_PX, y - HIT_SLOP_PX],
              [x + HIT_SLOP_PX, y + HIT_SLOP_PX],
            ],
            { layers },
          )
        : [];
      // The biggest under the pointer: at a junction it is the trunk, the
      // line drawn on top.
      const km2 = Math.max(
        ...hit.map((feature) => Number(feature.properties?.catchmentKm2)),
      );
      if (!Number.isFinite(km2)) {
        hide();
        return;
      }
      marker.setLngLat(event.lngLat);
      if (!shown) {
        shown = true;
        marker.addTo(map);
        canvas.style.cursor = "pointer";
      }
      setLabel(formatCatchmentKm2(km2));
    };
    map.on("mousemove", onMove);
    const onLeave = () => hide();
    canvas.addEventListener("mouseleave", onLeave);
    return () => {
      map.off("mousemove", onMove);
      canvas.removeEventListener("mouseleave", onLeave);
      hide(armed());
      marker.remove();
    };
  }, [map, el, pressable, armed]);

  return label ? createPortal(<MapTip>{label}</MapTip>, el) : null;
}
