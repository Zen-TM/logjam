import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import {
  MAP_POINT,
  MAP_POINT_NO_FIX_NOTE,
  WEATHER,
  mapPointCatchment,
  mapPointCatchmentNote,
  mapPointFacts,
  mapPointPosition,
  mapPointStepBack,
  mapPointVerbs,
  type MapPointView,
  type CarrierId,
  type MapPointCoord,
  type MapPointVerbId,
} from "@logjam/shared";
import { useElevationPoint, useFlowNetworkLookup } from "../../placeUtils";
import { useIsMobile } from "../../useIsMobile";
import { useToast } from "../feedback/ToastProvider";
import { WeatherView } from "../weather/WeatherView";
import { useOnline, useWeather } from "../weather/useWeather";
import {
  IconButton,
  IconTile,
  Popover,
  Row,
  StatGrid,
  type Stat,
} from "../../ui";
import { coverageAt, fireAt, landClassAt } from "./layerOrder";
import { PointAnchor } from "./PointAnchor";
import classes from "./MapPointPopover.module.css";

/**
 * "What is here?": the panel a press on empty map opens, anchored at the point
 * it asked about, with a dot left there (`MAP_POINT`, shared/contracts). It
 * shows the facts and one Options row; Options holds the verbs, and the weather
 * opens from there. The coordinates copy where they are pressed.
 *
 * Mounted only while a point is being asked about, so the elevation and
 * catchment requests are tied to the panel being open and never fire for a
 * stale point.
 *
 * PRIVACY (shared/DESIGN.md §13): the coordinate goes to this panel, and to
 * the clipboard when the user presses it; the toasts are fixed sentences.
 * `from` is the browser's own fix, which this never asks for.
 */
export default function MapPointPopover({
  map,
  point,
  from,
  coverageCarrier,
  startAt,
  onClose,
  onAddPlace,
  onMeasure,
  onDrawRoute,
  onShowUpstream,
}: {
  map: maplibregl.Map;
  point: MapPointCoord;
  /** The viewer's fix if the browser already has one, else null. */
  from: MapPointCoord | null;
  /** The carrier the Coverage overlay draws, or null before one is picked. */
  coverageCarrier: CarrierId | null;
  /** A right-click opens the panel on Options, with no facts to go back to. */
  startAt?: "options";
  onClose: () => void;
  onAddPlace: (point: MapPointCoord) => void;
  onMeasure: (point: MapPointCoord) => void;
  onDrawRoute: (point: MapPointCoord) => void;
  /** Draws the creeks upstream of the point; they outlive this panel. */
  onShowUpstream: (point: MapPointCoord) => void;
}) {
  const toast = useToast();
  // On narrow web the tab bar owns the bottom of the screen, and a panel below
  // the point would cover it (and sit too close to its buttons to press): it
  // opens above the point there instead.
  const narrow = useIsMobile();
  // The element the dot is drawn into, and the popover's anchor.
  const [anchorEl] = useState(() => document.createElement("div"));
  const anchorRef = useRef<HTMLElement | null>(anchorEl);

  // One request for the height and the slope.
  const { reading, loading } = useElevationPoint(
    point.longitude,
    point.latitude,
  );
  const metres = reading?.elevationM ?? null;
  const [{ land, fire, coverage }] = useState(() => {
    const { x, y } = map.project([point.longitude, point.latitude]);
    return {
      land: landClassAt(map, [x, y]),
      fire: fireAt(map, [x, y]),
      coverage:
        coverageCarrier &&
        coverageAt(
          map,
          [x, y],
          [point.longitude, point.latitude],
          coverageCarrier,
        ),
    };
  });

  // Options and the weather swap the body in place and back out one step
  // (shared/DESIGN.md §10). The press is what fetches the weather.
  const [view, setView] = useState<MapPointView>(startAt ?? "point");
  const online = useOnline();
  const weather = useWeather(point, metres);
  const bodyRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const previousView = useRef(view);
  // The pressed control is unmounted by the swap: focus goes to the arrow on
  // the way in and to the row that was opened on the way out
  // (frontend/DESIGN.md §2).
  useEffect(() => {
    const was = previousView.current;
    previousView.current = view;
    if (was === view) return;
    const deeper = view === "weather" || was === "point";
    if (deeper) backRef.current?.focus();
    else
      bodyRef.current
        ?.querySelector<HTMLButtonElement>(`[data-verb="${was}"] button`)
        ?.focus();
  }, [view]);

  // The Catchment row appears once a creek is found, and not at all
  // otherwise: the panel may grow by a line a moment after it opens.
  const catchment = mapPointCatchment(useFlowNetworkLookup(point).lookup);

  // Pressed too soon, the weather would be asked without a height and answer
  // for the cell's own DEM, which in canyon country can be far from the spot.
  const checkingHeight = loading;

  const copyPosition = () => {
    void navigator.clipboard
      .writeText(mapPointPosition(point))
      .then(() => toast.done(MAP_POINT.copy.coordinatesCopied))
      .catch(() => toast.error("Couldn't copy the coordinates."));
  };
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
    catchment,
    land,
    fire,
    coverage,
  }).map((fact) => ({
    label: fact.label,
    value: fact.value,
    ...(fact.note ? { note: fact.note } : {}),
    ...(fact.span ? { span: true } : {}),
    ...(fact.copyable ? { onCopy: copyPosition } : {}),
  }));

  const close = () => {
    onClose();
    // The dot is gone, and so is the thing focus was on: back to the map.
    map.getCanvas().focus();
  };

  const catchmentNote = mapPointCatchmentNote(catchment);

  const run: Record<
    Extract<
      MapPointVerbId,
      "drawRoute" | "addPlace" | "measure" | "upstream" | "weather"
    >,
    () => void
  > = {
    drawRoute: () => onDrawRoute(point),
    addPlace: () => onAddPlace(point),
    measure: () => onMeasure(point),
    upstream: () => onShowUpstream(point),
    weather: () => {
      setView("weather");
      weather.load();
    },
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
        label={MAP_POINT.title}
        placement={narrow ? "top-start" : "bottom-start"}
        fit
        dismissOnOutsidePress
        suppressAskWithin={map.getContainer()}
        // Escape undoes one layer: the forecast, then Options, then the panel.
        onEscape={() => {
          const back =
            view === "options" && startAt ? null : mapPointStepBack(view);
          if (back) setView(back);
          else close();
        }}
        closeButton={false}
      >
        <div className={classes.body} ref={bodyRef}>
          {view === "point" ? (
            <>
              <StatGrid stats={stats} />
              {catchmentNote && <p className={classes.note}>{catchmentNote}</p>}
              {from === null && (
                <p className={classes.note}>{MAP_POINT_NO_FIX_NOTE.web}</p>
              )}
              <Row
                title={MAP_POINT.copy.options}
                leading={<IconTile icon="overflow" hue="var(--color-accent)" />}
                data-verb="options"
                onOpen={() => setView("options")}
              />
            </>
          ) : (
            <>
              <div className={classes.viewHeader}>
                {!(view === "options" && startAt) && (
                  <IconButton
                    ref={backRef}
                    icon="back"
                    label={
                      view === "weather"
                        ? "Back to options"
                        : MAP_POINT.copy.backToPoint
                    }
                    onClick={() => setView(mapPointStepBack(view) ?? "point")}
                  />
                )}
                <span className={classes.viewTitle}>
                  {view === "weather" ? WEATHER.title : MAP_POINT.copy.options}
                </span>
              </div>
              {view === "weather" ? (
                <WeatherView
                  state={weather.state}
                  online={online}
                  onLoad={weather.load}
                  model={weather.model}
                  onModel={weather.chooseModel}
                />
              ) : (
                <div className={classes.verbs}>
                  {mapPointVerbs("web", false, {
                    creekFound: catchment !== null,
                  }).map((verb) => (
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
                        // The weather stays in the panel; the others go on to
                        // a flow of their own.
                        if (verb.id !== "weather") close();
                      }}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </Popover>
    </>
  );
}
