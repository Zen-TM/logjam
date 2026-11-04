import { useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import {
  MAP_POINT,
  mapHoldVerbs,
  type MapHoldVerbId,
  type MapPointCoord,
} from "@logjam/shared";
import { useIsMobile } from "../../useIsMobile";
import { IconTile, Popover, Row } from "../../ui";
import { PointAnchor } from "./PointAnchor";
import classes from "./MapPointPopover.module.css";

/**
 * "What goes here?": what a right-click or a long-press on the map offers, at
 * the point it was made. Its rows are `mapHoldVerbs("web")`, the same
 * vocabulary Logjam GPS's press-and-hold sheet draws, and each hands off to a
 * flow that asks for what it needs: nothing is written from here.
 */
export default function MapHoldMenu({
  map,
  point,
  onClose,
  run,
}: {
  map: maplibregl.Map;
  point: MapPointCoord;
  onClose: () => void;
  /** A `Record` over the hold's ids: `tsc` refuses a verb with no flow. */
  run: Record<MapHoldVerbId<"web">, (point: MapPointCoord) => void>;
}) {
  const narrow = useIsMobile();
  const [anchorEl] = useState(() => document.createElement("div"));
  const anchorRef = useRef<HTMLElement | null>(anchorEl);

  const close = () => {
    onClose();
    map.getCanvas().focus();
  };

  return (
    <>
      <PointAnchor
        map={map}
        point={point}
        element={anchorEl}
        onClose={onClose}
      />
      <Popover
        open
        onClose={close}
        anchorRef={anchorRef}
        label={MAP_POINT.copy.holdTitle}
        placement={narrow ? "top-start" : "bottom-start"}
        fit
        dismissOnOutsidePress
        swallowWithin={map.getContainer()}
        closeButton={false}
      >
        <div className={classes.body}>
          <div className={classes.verbs}>
            {mapHoldVerbs("web").map((verb) => (
              <Row
                key={verb.id}
                title={verb.label}
                leading={
                  <IconTile icon={verb.icon} hue="var(--color-accent)" />
                }
                data-verb={verb.id}
                onOpen={() => {
                  run[verb.id as MapHoldVerbId<"web">](point);
                  // Focus back to the map, as the tap panel does: the row that
                  // had it is gone.
                  close();
                }}
              />
            ))}
          </div>
        </div>
      </Popover>
    </>
  );
}
