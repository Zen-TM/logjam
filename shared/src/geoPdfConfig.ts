import type { PaperSize, Orientation, CoordMode } from "./geoPdfExtent.js";

export interface CanyonMarker {
  lat: number;
  lon: number;
  name: string;
  color: "owned" | "shared";
}

export interface GeoPdfConfig {
  paperSize: PaperSize;
  orientation: Orientation;
  customRatio?: { w: number; h: number };
  extent: { north: number; south: number; east: number; west: number };
  scale: number;
  baseLayer: string;
  overlays: string[];
  elements: {
    title?: string;
    compass: boolean;
    contourInterval?: number;
    scaleText: boolean;
    scaleBar: boolean;
    gridLines?: CoordMode;
  };
  canyonMarkers?: CanyonMarker[];
}
