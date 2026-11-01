import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as maplibregl from "maplibre-gl";
import {
  MAP_POINT,
  MAP_POINT_NO_FIX_NOTE,
  WEATHER,
  mapPointFacts,
  mapPointVerbs,
  type MapPointCoord,
  type MapPointVerbId,
} from "@logjam/shared";
import { useElevationPoint } from "../../placeUtils";
import { useIsMobile } from "../../useIsMobile";
import { useToast } from "../feedback/ToastProvider";
import { WeatherView } from "../weather/WeatherView";
import { useOnline, useWeather } from "../weather/useWeather";
import {
  IconButton,
  IconTile,
  MapPointDot,
  Popover,
  Row,
  StatGrid,
  type Stat,
} from "../../ui";
import { landClassAt } from "./layerOrder";
import classes from "./MapPointPopover.module.css";

/**
 * "What is here?": the panel a press on empty map opens, anchored at the point
 * it asked about, with a dot left there (`MAP_POINT`, shared/contracts).
 *
 * Mounted only while a point is being asked about, so the elevation request is
 * tied to the panel being open and never fires for a stale point.
 *
 * PRIVACY (shared/DESIGN.md §13): the coordinate goes to this panel, and to
 * the clipboard when the user presses Copy; the toasts are fixed sentences.
 * `from` is the browser's own fix, which this never asks for.
 */
export default function MapPointPopover({
  map,
  point,
  from,
  onClose,
  onAddPlace,
  onMeasure,
}: {
  map: maplibregl.Map;
  point: MapPointCoord;
  /** The viewer's fix if the browser already has one, else null. */
  from: MapPointCoord | null;
  onClose: () => void;
  onAddPlace: (point: MapPointCoord) => void;
  onMeasure: (point: MapPointCoord) => void;
}) {
  const toast = useToast();
  // On narrow web the tab bar owns the bottom of the screen, and a panel below
  // the point would cover it (and sit too close to its buttons to press): it
  // opens above the point there instead.
  const narrow = useIsMobile();
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

  // One request for the height and the slope.
  const { reading, loading } = useElevationPoint(
    point.longitude,
    point.latitude,
  );
  const metres = reading?.elevationM ?? null;
  const [land] = useState(() => {
    const { x, y } = map.project([point.longitude, point.latitude]);
    return landClassAt(map, [x, y]);
  });

  // "Show the weather here" swaps the body for the forecast in place and backs
  // out to the facts (shared/DESIGN.md §10). The press is what fetches.
  const [view, setView] = useState<"point" | "weather">("point");
  const online = useOnline();
  const weather = useWeather(point, metres);
  const bodyRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const viewChanged = useRef(false);
  // The pressed control is unmounted by the swap: focus goes to the arrow on
  // the way in and to the opened row on the way out (frontend/DESIGN.md §2).
  useEffect(() => {
    if (!viewChanged.current) return;
    if (view === "weather") backRef.current?.focus();
    else
      bodyRef.current
        ?.querySelector<HTMLButtonElement>('[data-verb="weather"] button')
        ?.focus();
  }, [view]);

  // Pressed too soon, the weather would be asked without a height and answer
  // for the cell's own DEM, which in canyon country can be far from the spot.
  const checkingHeight = loading;

  const stats: Stat[] = mapPointFacts({
    point,
    elevation:
      metres != null
        ? { state: "known", metres }
        : loading
          ? { state: "checking" }
          : { state: "unavailable" },
    from,
    slopeDegrees: reading?.slopeDegrees ?? null,
    land,
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
    Extract<MapPointVerbId, "addPlace" | "measure" | "copy" | "weather">,
    () => void
  > = {
    addPlace: () => onAddPlace(point),
    measure: () => onMeasure(point),
    weather: () => {
      viewChanged.current = true;
      setView("weather");
      weather.load();
    },
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
        placement={narrow ? "top-start" : "bottom-start"}
        fit
        dismissOnOutsidePress
      >
        {view === "weather" ? (
          <div className={classes.body} ref={bodyRef}>
            <div className={classes.weatherHeader}>
              <IconButton
                ref={backRef}
                icon="back"
                label="Back to this point"
                onClick={() => {
                  viewChanged.current = true;
                  setView("point");
                }}
              />
              <span className={classes.weatherTitle}>{WEATHER.title}</span>
            </div>
            <WeatherView
              state={weather.state}
              online={online}
              onLoad={weather.load}
            />
          </div>
        ) : (
          <div className={classes.body} ref={bodyRef}>
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
                  data-verb={verb.id}
                  {...(verb.id === "weather" && (!online || checkingHeight)
                    ? {
                        disabled: true,
                        subtitle: online
                          ? MAP_POINT.copy.elevationChecking
                          : WEATHER.copy.needsConnection,
                      }
                    : {})}
                  onOpen={() => {
                    run[verb.id as keyof typeof run]();
                    // Copy and weather leave the panel where it is; the others
                    // go on to a flow of their own.
                    if (verb.id !== "copy" && verb.id !== "weather") close();
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </Popover>
    </>
  );
}
