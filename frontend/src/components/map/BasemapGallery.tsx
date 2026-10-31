import { useRef, type KeyboardEvent } from "react";
import { PROTOMAPS_SWATCH } from "../../basemapSwatch";
import { nextEnabledIndex } from "../../ui/rovingFocus";
import { previewUrlFor, type TileLayer } from "../sidebar/panels/tilePreview";
import classes from "./LayersPopover.module.css";

export type BaseLayer = TileLayer & { id: string; name: string };

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
}: {
  label: string;
  layers: readonly BaseLayer[];
  activeLayerId: string;
  onChange: (id: string) => void;
  mapView: { lng: number; lat: number; zoom: number } | null;
}) {
  const tileRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const activeIndex = layers.findIndex((layer) => layer.id === activeLayerId);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const from = tileRefs.current.findIndex(
      (tile) => tile === document.activeElement,
    );
    const to = nextEnabledIndex(
      layers.map(() => false),
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
      className={classes.gallery}
      onKeyDown={onKeyDown}
    >
      {layers.map((layer, index) => {
        const active = layer.id === activeLayerId;
        const thumbnail =
          mapView && layer.tiles.length > 0
            ? previewUrlFor(layer, mapView)
            : null;
        return (
          <button
            key={layer.id}
            ref={(tile) => {
              tileRefs.current[index] = tile;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={index === (activeIndex < 0 ? 0 : activeIndex) ? 0 : -1}
            className={classes.tile}
            onClick={() => onChange(layer.id)}
          >
            {thumbnail ? (
              <img
                src={thumbnail}
                alt=""
                className={classes.thumb}
                draggable={false}
              />
            ) : (
              <VectorSwatch />
            )}
            <span className={classes.caption}>{layer.name}</span>
          </button>
        );
      })}
    </div>
  );
}
