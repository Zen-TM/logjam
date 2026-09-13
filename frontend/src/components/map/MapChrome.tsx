import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type maplibregl from "maplibre-gl";
import { Compass, LocateFixed, Minus, Mountain, PencilRuler, Plus, type LucideIcon } from "lucide-react";
import { MapButton, MapButtonGroup, Menu, useEscape, type MenuEntry } from "../../ui";
import { useToast } from "../feedback/ToastProvider";
import classes from "./MapChrome.module.css";

export type MapTool =
  | { id: string; label: string; icon: LucideIcon; onSelect: () => void }
  | { id: string; label: string; icon: LucideIcon; menu: readonly MenuEntry[] };

type LocateState = "off" | "waiting" | "on" | "error";

/** MapLibre's GeolocateControl state, read from the classes it puts on its own
 *  (hidden) button — the documented styling hooks for exactly this. */
function locateStateOf(button: Element): LocateState {
  const has = (name: string) => button.classList.contains(`maplibregl-ctrl-geolocate-${name}`);
  if (has("waiting")) return "waiting";
  if (has("active-error") || has("background-error")) return "error";
  if (has("active") || has("background")) return "on";
  return "off";
}

/**
 * The controls floating over the map, in two edges: the ACTION edge on the right
 * (Layers in its own corner; Tools, 3D, locate and zoom stacked above the
 * credits) and the INSTRUMENT edge on the left (compass beside MapLibre's scale
 * bar). Search is top-left with notices beneath it.
 *
 * Zoom, compass and locate are our own buttons driving the map through its
 * public API, so they share the kit's size, focus ring and labels; locate still
 * uses MapLibre's GeolocateControl underneath for the dot, the accuracy circle
 * and follow mode.
 */
export default function MapChrome({
  map,
  geolocate,
  is3D,
  onToggle3D,
  search,
  notices,
  layersButton,
  tools,
}: {
  /** Null until the map has loaded. */
  map: maplibregl.Map | null;
  geolocate: maplibregl.GeolocateControl | null;
  is3D: boolean;
  onToggle3D: () => void;
  search: ReactNode;
  notices?: ReactNode;
  layersButton?: ReactNode;
  tools: readonly MapTool[];
}) {
  const toast = useToast();
  const [bearing, setBearing] = useState(0);
  const [zoom, setZoom] = useState({ atMin: false, atMax: false });
  const [locate, setLocate] = useState<LocateState>("off");
  const [toolsOpen, setToolsOpen] = useState(false);
  const trayId = useId();
  const trayRef = useRef<HTMLDivElement>(null);
  const toolsButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!map) return;
    const sync = () => {
      setBearing(map.getBearing());
      const current = map.getZoom();
      setZoom({ atMin: current <= map.getMinZoom(), atMax: current >= map.getMaxZoom() });
    };
    sync();
    map.on("rotate", sync);
    map.on("zoomend", sync);
    return () => {
      map.off("rotate", sync);
      map.off("zoomend", sync);
    };
  }, [map]);

  useEffect(() => {
    if (!map || !geolocate) return;
    const button = map.getContainer().querySelector(".maplibregl-ctrl-geolocate");
    if (!button) throw new Error("GeolocateControl button not found — was the control added?");
    const observer = new MutationObserver(() => setLocate(locateStateOf(button)));
    observer.observe(button, { attributes: true, attributeFilter: ["class"] });
    const onError = () => toast.error("Couldn't find your location. Check that this site may use it.");
    geolocate.on("error", onError);
    return () => {
      observer.disconnect();
      geolocate.off("error", onError);
    };
  }, [map, geolocate, toast]);

  useEscape(toolsOpen ? trayRef : null, () => {
    setToolsOpen(false);
    toolsButtonRef.current?.focus();
  });

  const runTool = (action: () => void) => {
    setToolsOpen(false);
    action();
  };

  return (
    <>
      <div className={classes.topLeft}>{search}</div>
      {notices && (
        <div className={classes.notices} aria-live="polite">
          {notices}
        </div>
      )}
      <div className={classes.topRight}>{layersButton}</div>

      <div className={classes.actions}>
        <div className={classes.toolsLine}>
          {toolsOpen && (
            <div ref={trayRef} id={trayId} role="group" aria-label="Tools" className={classes.tray}>
              {tools.map((tool) =>
                "menu" in tool ? (
                  <Menu
                    key={tool.id}
                    label={tool.label}
                    placement="top-end"
                    entries={tool.menu.map((entry) =>
                      "separator" in entry ? entry : { ...entry, onSelect: () => runTool(entry.onSelect) },
                    )}
                    trigger={(props) => (
                      <button {...props} type="button" className={classes.trayItem}>
                        <tool.icon size={18} aria-hidden className={classes.trayGlyph} />
                        {tool.label}
                      </button>
                    )}
                  />
                ) : (
                  <button
                    key={tool.id}
                    type="button"
                    className={classes.trayItem}
                    onClick={() => runTool(tool.onSelect)}
                  >
                    <tool.icon size={18} aria-hidden className={classes.trayGlyph} />
                    {tool.label}
                  </button>
                ),
              )}
            </div>
          )}
          <MapButton
            ref={toolsButtonRef}
            icon={PencilRuler}
            label="Tools"
            expanded={toolsOpen}
            aria-controls={toolsOpen ? trayId : undefined}
            onClick={() => setToolsOpen((current) => !current)}
          />
        </div>
        <MapButton icon={Mountain} label="3D terrain" pressed={is3D} onClick={onToggle3D} disabled={!map} />
        <MapButton
          icon={LocateFixed}
          label="Show my location"
          pressed={locate === "on" || locate === "waiting"}
          aria-busy={locate === "waiting"}
          disabled={!geolocate}
          onClick={() => geolocate?.trigger()}
        />
        <MapButtonGroup label="Zoom">
          <MapButton icon={Plus} label="Zoom in" disabled={!map || zoom.atMax} onClick={() => map?.zoomIn()} />
          <MapButton icon={Minus} label="Zoom out" disabled={!map || zoom.atMin} onClick={() => map?.zoomOut()} />
        </MapButtonGroup>
      </div>

      <div className={classes.instruments}>
        <MapButton
          icon={Compass}
          label="Reset north"
          disabled={!map}
          className={classes.compass}
          style={{ "--bearing": `${bearing}deg` } as CSSProperties}
          onClick={() => map?.resetNorthPitch()}
        />
      </div>
    </>
  );
}
