import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as maplibregl from "maplibre-gl";
import {
  MAP_POINT,
  MAP_POINT_NO_FIX_NOTE,
  mapPointFacts,
  mapPointVerbs,
  type MapPointCoord,
  type MapPointVerbId,
} from "@logjam/shared";
import { useElevationProfile } from "../../placeUtils";
import { useToast } from "../feedback/ToastProvider";
import {
  IconTile,
  MapPointDot,
  Popover,
  Row,
  StatGrid,
  type Stat,
} from "../../ui";
import classes from "./MapPointPopover.module.css";

/**
 * "What is here?": the panel a press on empty map opens, anchored at the point
 * it asked about, with a dot left there (`MAP_POINT`, shared/contracts).
 *
 * Mounted only while a point is being asked about, so the elevation request is
 * tied to the panel being open and never fires for a stale point.
 *
 * PRIVACY (shared/DESIGN.md §13): the coordinate is on this panel and the
 * clipboard when the user presses Copy, and nowhere else: not in a toast, a
 * log or an error. `from` is the browser's own fix, which this never asks for.
 */
export default function MapPointPopover({
  map,
  point,
  from,
  onClose,
  onAddPlace,
  onDrawRoute,
}: {
  map: maplibregl.Map;
  point: MapPointCoord;
  /** The viewer's fix if the browser already has one, else null. */
  from: MapPointCoord | null;
  onClose: () => void;
  onAddPlace: (point: MapPointCoord) => void;
  onDrawRoute: (point: MapPointCoord) => void;
}) {
  const toast = useToast();
  // The element the dot is drawn into, and the popover's anchor: a marker, so
  // it stays on the point while the map moves under it.
  const [anchorEl] = useState(() => document.createElement("div"));
  const anchorRef = useRef<HTMLElement | null>(anchorEl);

  useEffect(() => {
    const marker = new maplibregl.Marker({ element: anchorEl })
      .setLngLat([point.longitude, point.latitude])
      .addTo(map);
    // The point stays put while the map moves, so the popover would be left
    // beside nothing: moving the map is looking away.
    map.on("movestart", onClose);
    return () => {
      map.off("movestart", onClose);
      marker.remove();
    };
  }, [map, point, anchorEl, onClose]);

  // The elevation endpoint profiles a LINE, and the shortest legal one is two
  // points: the second is nudged east by ~1 m, inside the DEM's own cell size
  // (Logjam GPS does the same).
  const profile = useElevationProfile([
    [point.longitude, point.latitude],
    [point.longitude + 0.00001, point.latitude],
  ]);
  const metres = profile.profile?.samples[0]?.elevationM ?? null;

  const stats: Stat[] = mapPointFacts({
    point,
    elevation:
      metres != null
        ? { state: "known", metres }
        : profile.loading || (!profile.error && profile.profile === null)
          ? { state: "checking" }
          : { state: "unavailable" },
    from,
  }).map((fact) => ({
    label: fact.label,
    value: fact.value,
    ...(fact.span ? { span: true } : {}),
  }));

  const close = () => {
    onClose();
    // The dot is gone, and so is the thing focus was on: back to the map.
    map.getCanvas().focus();
  };

  const run: Record<
    Extract<MapPointVerbId, "addPlace" | "drawRoute" | "copy">,
    () => void
  > = {
    addPlace: () => onAddPlace(point),
    drawRoute: () => onDrawRoute(point),
    copy: () => {
      void navigator.clipboard
        .writeText(
          `${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}`,
        )
        .then(() => toast.success(MAP_POINT.copy.coordinatesCopied))
        .catch(() => toast.error("Couldn't copy the coordinates."));
    },
  };

  return (
    <>
      {createPortal(<MapPointDot />, anchorEl)}
      <Popover
        open
        onClose={close}
        anchorRef={anchorRef}
        label={MAP_POINT.title}
        placement="bottom-start"
        fit
        dismissOnOutsidePress
      >
        <div className={classes.body}>
          <StatGrid stats={stats} />
          {from === null && (
            <p className={classes.note}>{MAP_POINT_NO_FIX_NOTE.web}</p>
          )}
          <div className={classes.verbs}>
            {mapPointVerbs("web").map((verb) => (
              <Row
                key={verb.id}
                title={verb.label}
                leading={
                  <IconTile icon={verb.icon} hue="var(--color-accent)" />
                }
                onOpen={() => {
                  run[verb.id as keyof typeof run]();
                  // Copy leaves the panel where it is; the others go on to a
                  // flow of their own.
                  if (verb.id !== "copy") close();
                }}
              />
            ))}
          </div>
        </div>
      </Popover>
    </>
  );
}
