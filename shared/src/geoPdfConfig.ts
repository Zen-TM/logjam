import type { PaperSize, Orientation, CoordMode } from "./geoPdfExtent";

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
}
