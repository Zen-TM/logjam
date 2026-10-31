import { useCallback, useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import { GAUGES, type Gauge } from "@logjam/shared";
import { useIsMobile } from "../../useIsMobile";
import { Popover } from "../../ui";
import { GaugeView } from "./GaugeView";

/** A gauge pressed on the map, anchored at the gauge. Mounted only while one
 *  is open; closing, or moving the map, takes it away. */
export default function GaugePopover({
  map,
  gauge,
  attribution,
  generatedAt,
  onClose,
}: {
  map: maplibregl.Map;
  gauge: Gauge;
  attribution: string;
  generatedAt: string;
  onClose: (id: string) => void;
}) {
  const narrow = useIsMobile();
  const close = useCallback(() => onClose(gauge.id), [onClose, gauge.id]);
  const [now] = useState(Date.now);
  const [anchorEl] = useState(() => document.createElement("div"));
  const anchorRef = useRef<HTMLElement | null>(anchorEl);
  useEffect(() => {
    const marker = new maplibregl.Marker({ element: anchorEl })
      .setLngLat([gauge.lon, gauge.lat])
      .addTo(map);
    map.on("movestart", close);
    return () => {
      map.off("movestart", close);
      marker.remove();
    };
  }, [map, gauge.lon, gauge.lat, anchorEl, close]);
  return (
    <Popover
      open
      onClose={() => {
        close();
        map.getCanvas().focus();
      }}
      anchorRef={anchorRef}
      label={GAUGES.title}
      placement={narrow ? "top-start" : "bottom-start"}
      fit
      dismissOnOutsidePress
    >
      <GaugeView
        gauge={gauge}
        attribution={attribution}
        generatedAt={generatedAt}
        now={now}
      />
    </Popover>
  );
}
