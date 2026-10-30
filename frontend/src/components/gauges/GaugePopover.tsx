import { useEffect, useRef, useState } from "react";
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
  onClose: () => void;
}) {
  const narrow = useIsMobile();
  const [now] = useState(Date.now);
  const [anchorEl] = useState(() => document.createElement("div"));
  const anchorRef = useRef<HTMLElement | null>(anchorEl);
  useEffect(() => {
    const marker = new maplibregl.Marker({ element: anchorEl })
      .setLngLat([gauge.lon, gauge.lat])
      .addTo(map);
    map.on("movestart", onClose);
    return () => {
      map.off("movestart", onClose);
      marker.remove();
    };
  }, [map, gauge.lon, gauge.lat, anchorEl, onClose]);
  return (
    <Popover
      open
      onClose={() => {
        onClose();
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
