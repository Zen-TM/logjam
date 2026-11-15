// The map's on-screen scale bar: MapLibre's own control, in the display units.
// MapLibre writes "ft" and "mi" for `imperial`. Test: `scaleControl.test.ts`.
import * as maplibregl from "maplibre-gl";
import type { Units } from "@logjam/shared";

export function makeScaleControl(
  units: Units,
  narrow: boolean,
): maplibregl.ScaleControl {
  return new maplibregl.ScaleControl({
    unit: units,
    maxWidth: narrow ? 100 : 160,
  });
}
