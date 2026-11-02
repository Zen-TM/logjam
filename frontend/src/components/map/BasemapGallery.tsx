import { useRef, useState, type KeyboardEvent } from "react";
import {
  BASEMAP_CATALOG,
  BASEMAP_UNAVAILABLE_LABEL,
  serverAnswers,
} from "@logjam/shared";
import { Icon } from "../../ui/Icon";
import { PROTOMAPS_SWATCH } from "../../basemapSwatch";
import { nextEnabledIndex } from "../../ui/rovingFocus";
import { previewUrlFor, type TileLayer } from "../sidebar/panels/tilePreview";
import classes from "./BasemapGallery.module.css";

export type BaseLayer = TileLayer & { id: string; name: string };

// A vector basemap has no XYZ tile, so its swatch is the tile of the raster
// rendering of the same OpenStreetMap cartography: it tracks the view like the
// others for one image, where a second WebGL map per swatch would not. It is
// a lookalike, not the style itself, so a failed load only falls back to the
// drawn scrap below and never marks the basemap down (that tile is OSM's
// server, not our archive).
const OSM_LOOKALIKE = (() => {
  const osm = BASEMAP_CATALOG.find((entry) => entry.id === "osm");
  if (!osm) throw new Error("osm missing from BASEMAP_CATALOG");
  return { tiles: [osm.urlTemplate], maxzoom: osm.displayMaxZoom };
})();

/** A drawn scrap of the vector basemap's own palette — land, a creek, a road
 *  and a lane — because a vector basemap has no XYZ tile to thumbnail. */
function VectorSwatch() {
  return (
    <svg
      className={classes.thumb}
      viewBox="0 0 40 40"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <rect width="40" height="40" fill={PROTOMAPS_SWATCH.earth} />
      <path
        d="M-2 27 C 8 22, 12 32, 22 27 S 34 18, 42 22"
        fill="none"
        stroke={PROTOMAPS_SWATCH.water}
        strokeWidth="3"
      />
      <path
        d="M-2 14 L 42 9"
        stroke={PROTOMAPS_SWATCH.road}
        strokeWidth="3.5"
      />
      <path
        d="M14 -2 L 20 42"
        stroke={PROTOMAPS_SWATCH.minor}
        strokeWidth="2"
      />
    </svg>
  );
}

export default function BasemapGallery({
  label,
  layers,
  activeLayerId,
  onChange,
  mapView,
  unavailable,
  onHealth,
  oneRow = false,
}: {
  label: string;
  layers: readonly BaseLayer[];
  activeLayerId: string;
  onChange: (id: string) => void;
  mapView: { lng: number; lat: number; zoom: number } | null;
  /** Basemaps whose tile server is down: drawn as such and not selectable. */
  unavailable?: ReadonlySet<string>;
  /** A swatch tile loaded (`false`) or failed (`true`). The gallery remounts
   *  when the panel opens, so a recovered server is found on the next open. */
  onHealth?: (id: string, down: boolean) => void;
  oneRow?: boolean;
}) {
  const [lookalikeFailed, setLookalikeFailed] = useState(false);
  const tileRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // The one tab stop: the active tile, or the first enabled one when the
  // active basemap is down (its button is disabled, so it can't take focus).
  const activeIndex = layers.findIndex((layer) => layer.id === activeLayerId);
  const tabStop =
    activeIndex >= 0 && !unavailable?.has(layers[activeIndex].id)
      ? activeIndex
      : layers.findIndex((layer) => !unavailable?.has(layer.id));

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const from = tileRefs.current.findIndex(
      (tile) => tile === document.activeElement,
    );
    const to = nextEnabledIndex(
      layers.map((layer) => unavailable?.has(layer.id) ?? false),
      from,
      event.key,
    );
    if (to == null) return;
    event.preventDefault();
    tileRefs.current[to]?.focus();
    onChange(layers[to].id);
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      tabIndex={-1}
      className={`${classes.gallery} ${oneRow ? classes.oneRow : ""}`}
      onKeyDown={onKeyDown}
    >
      {layers.map((layer, index) => {
        const active = layer.id === activeLayerId;
        const vector = layer.tiles.length === 0;
        const down = unavailable?.has(layer.id) ?? false;
        const thumbnail = !mapView
          ? null
          : vector
            ? lookalikeFailed
              ? null
              : previewUrlFor(OSM_LOOKALIKE, mapView)
            : previewUrlFor(layer, mapView);
        return (
          <button
            key={layer.id}
            ref={(tile) => {
              tileRefs.current[index] = tile;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={index === tabStop ? 0 : -1}
            className={classes.tile}
            disabled={down}
            onClick={() => onChange(layer.id)}
          >
            {thumbnail ? (
              // Kept while down: its load is the probe that clears the state.
              <img
                src={thumbnail}
                alt=""
                className={`${classes.thumb} ${down ? classes.hidden : ""}`}
                draggable={false}
                onLoad={vector ? undefined : () => onHealth?.(layer.id, false)}
                onError={() => {
                  if (vector) return setLookalikeFailed(true);
                  // A 404 is a tile outside the provider's coverage, not an
                  // outage: ask the server before marking it down.
                  void serverAnswers(thumbnail).then((ok) => {
                    if (!ok) onHealth?.(layer.id, true);
                  });
                }}
              />
            ) : (
              <VectorSwatch />
            )}
            {down && (
              <span className={classes.down}>
                <Icon idea="warning" size={18} />
                {BASEMAP_UNAVAILABLE_LABEL}
              </span>
            )}
            <span className={classes.caption}>{layer.name}</span>
          </button>
        );
      })}
    </div>
  );
}
