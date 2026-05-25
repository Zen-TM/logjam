// Topo generation render settings. Single source of truth for defaults and
// validation. Consumed by API (POST /topo-jobs, /topo-templates), frontend
// (TopoDialog), and worker.py (defence-in-depth re-validation).

export type TopoLayerKey = "hillshade" | "vegetation" | "slope" | "contours" | "features";

export type RgbaHex = string; // #RRGGBBAA, lowercase hex

export interface HillshadeSettings {
  enabled: boolean;
  colour: RgbaHex;     // tint applied to greyscale luminance
  azimuth: number;     // 0–360
  altitude: number;    // 0–90
  zFactor: number;     // > 0, vertical exaggeration
  multidirectional: boolean;
}

export interface SlopeBand {
  fromDeg: number;     // inclusive
  toDeg: number;       // exclusive
  colour: RgbaHex;
}

export interface SlopeSettings {
  enabled: boolean;
  bands: SlopeBand[];  // ordered ascending, max 8
}

export interface VegetationSettings {
  enabled: boolean;
  minRatio: number;        // 0..1
  maxRatio: number;        // 0..1, > minRatio
  sparseColour: RgbaHex;   // alpha ignored; uses alphaMin instead
  denseColour: RgbaHex;    // alpha ignored; uses alphaMax instead
  alphaMin: number;        // 0..255
  alphaMax: number;        // 0..255
  weightsEnabled: boolean; // false → all μ treated as 1.0 in pipeline
  formationWeights: Record<string, number>; // formation name → μ (0..5 sane range)
}

export interface ContourZoomBand {
  zoomMin: number;       // inclusive (fixed at 12/15/17 for the three bands)
  zoomMax: number;       // inclusive (fixed at 15/16/18)
  intervalM: number;     // contour vertical spacing in metres
  majorEveryN: number;   // every Nth contour rendered with major style
}

export interface ContoursSettings {
  enabled: boolean;
  zoomBands: ContourZoomBand[];   // length 3, indices/zooms fixed
  majorColour: RgbaHex;
  minorColour: RgbaHex;
  majorWidthM: number;             // line thickness in ground metres
  minorWidthM: number;
}

export type OsmFeatureKey =
  | "waterway" | "track" | "road" | "building" | "power"
  | "campsite" | "peak" | "spring" | "gate" | "cave"
  | "bridge" | "ford" | "waterfall" | "trailhead" | "viewpoint" | "hut";

export interface OsmFeatureStyle {
  enabled: boolean;
  colour: RgbaHex;
  widthZ18: number;   // applies to line/point styling; >= 0
}

export interface OsmFeaturesSettings {
  enabled: boolean;
  features: Record<OsmFeatureKey, OsmFeatureStyle>;
}

export interface TopoSettings {
  hillshade: HillshadeSettings;
  slope: SlopeSettings;
  vegetation: VegetationSettings;
  contours: ContoursSettings;
  features: OsmFeaturesSettings;
}

export const OSM_FEATURE_KEYS: OsmFeatureKey[] = [
  "waterway", "track", "road", "building", "power",
  "campsite", "peak", "spring", "gate", "cave",
  "bridge", "ford", "waterfall", "trailhead", "viewpoint", "hut",
];

// Point features use fixed-design bitmap icons — no colour/width override.
export const OSM_POINT_FEATURE_KEYS = [
  "campsite", "peak", "spring", "gate", "cave",
  "ford", "waterfall", "trailhead", "viewpoint", "hut",
] as const;
export type OsmPointFeatureKey = typeof OSM_POINT_FEATURE_KEYS[number];

// Line/polygon features retain colour + width overrides.
export const OSM_LINE_FEATURE_KEYS = [
  "waterway", "track", "road", "building", "power", "bridge",
] as const;
export type OsmLineFeatureKey = typeof OSM_LINE_FEATURE_KEYS[number];

// Labels used by the OSM features UI tab.
export const OSM_FEATURE_LABELS: Record<OsmFeatureKey, string> = {
  waterway: "Waterways",
  track: "Tracks / paths",
  road: "Roads",
  building: "Buildings",
  power: "Power lines",
  campsite: "Campsites",
  peak: "Peaks",
  spring: "Springs",
  gate: "Gates / barriers",
  cave: "Cave entrances",
  bridge: "Bridges",
  ford: "Fords",
  waterfall: "Waterfalls",
  trailhead: "Trailheads",
  viewpoint: "Viewpoints",
  hut: "Huts / shelters",
};

// Plain-language description of the underlying OSM query for tooltip copy.
export const OSM_FEATURE_TAG_HINTS: Record<OsmFeatureKey, string> = {
  waterway: "OSM `waterway` ways (rivers, streams, creeks, canals, drains)",
  track: "OSM `highway=track|path|footway|bridleway|steps`",
  road: "OSM `highway=primary|secondary|tertiary|unclassified|residential|service`",
  building: "OSM `building=*`",
  power: "OSM `power=line|minor_line|cable`",
  campsite: "OSM `tourism=camp_site|caravan_site|wilderness_hut|alpine_hut`",
  peak: "OSM `natural=peak`",
  spring: "OSM `natural=spring`",
  gate: "OSM `barrier=gate|lift_gate|cycle_barrier`",
  cave: "OSM `natural=cave_entrance`",
  bridge: "OSM `bridge=yes` ways",
  ford: "OSM `ford=*` (water crossings)",
  waterfall: "OSM `waterway=waterfall`",
  trailhead: "OSM `information=guidepost` and `highway=trailhead`",
  viewpoint: "OSM `tourism=viewpoint`",
  hut: "OSM `tourism=alpine_hut|wilderness_hut` and `amenity=shelter`",
};

// Formation list must match topo/build_svtm_formation.py SVTM_FORMATION_MU
// keys (index 0 = "Not classified"). Mirrored here so the frontend can render
// the weights table without round-tripping the worker.
export const SVTM_FORMATIONS: string[] = [
  "Not classified",
  "Rainforests",
  "Wet Sclerophyll Forests (Grassy sub-formation)",
  "Wet Sclerophyll Forests (Shrubby sub-formation)",
  "Dry Sclerophyll Forests (Shrub/grass sub-formation)",
  "Dry Sclerophyll Forests (Shrubby sub-formation)",
  "Grassy Woodlands",
  "Grasslands",
  "Heathlands",
  "Forested Wetlands",
  "Freshwater Wetlands",
  "Saline Wetlands",
  "Semi-arid Woodlands (Grassy sub-formation)",
  "Semi-arid Woodlands (Shrubby sub-formation)",
  "Arid Shrublands (Acacia sub-formation)",
  "Arid Shrublands (Chenopod sub-formation)",
  "Alpine Complex",
];

export const TOPO_SETTINGS_DEFAULTS: TopoSettings = {
  hillshade: {
    enabled: true,
    colour: "#ffffffff",
    azimuth: 315,
    altitude: 45,
    zFactor: 1.5,
    multidirectional: false,
  },
  slope: {
    enabled: true,
    bands: [
      { fromDeg: 40, toDeg: 50, colour: "#ffff008c" },
      { fromDeg: 50, toDeg: 60, colour: "#ffa500a0" },
      { fromDeg: 60, toDeg: 70, colour: "#dc2626b4" },
      { fromDeg: 70, toDeg: 90, colour: "#780000c8" },
    ],
  },
  vegetation: {
    enabled: true,
    minRatio: 0.05,
    maxRatio: 0.45,
    sparseColour: "#90ee90ff",
    denseColour: "#006400ff",
    alphaMin: 60,
    alphaMax: 255,
    weightsEnabled: true,
    formationWeights: {
      "Not classified": 1.0,
      "Rainforests": 0.7,
      "Wet Sclerophyll Forests (Grassy sub-formation)": 0.9,
      "Wet Sclerophyll Forests (Shrubby sub-formation)": 1.2,
      "Dry Sclerophyll Forests (Shrub/grass sub-formation)": 1.2,
      "Dry Sclerophyll Forests (Shrubby sub-formation)": 1.5,
      "Grassy Woodlands": 0.7,
      "Grasslands": 0.5,
      "Heathlands": 1.8,
      "Forested Wetlands": 1.1,
      "Freshwater Wetlands": 1.3,
      "Saline Wetlands": 1.0,
      "Semi-arid Woodlands (Grassy sub-formation)": 0.9,
      "Semi-arid Woodlands (Shrubby sub-formation)": 1.3,
      "Arid Shrublands (Acacia sub-formation)": 1.4,
      "Arid Shrublands (Chenopod sub-formation)": 1.0,
      "Alpine Complex": 1.4,
    },
  },
  contours: {
    enabled: true,
    zoomBands: [
      { zoomMin: 12, zoomMax: 15, intervalM: 50, majorEveryN: 1 },
      { zoomMin: 15, zoomMax: 16, intervalM: 10, majorEveryN: 5 },
      { zoomMin: 17, zoomMax: 18, intervalM: 5, majorEveryN: 10 },
    ],
    majorColour: "#503c28dc",
    minorColour: "#785a3ca0",
    majorWidthM: 18,
    minorWidthM: 8,
  },
  features: {
    enabled: true,
    features: {
      waterway: { enabled: true, colour: "#2878dcdc", widthZ18: 3 },
      track:    { enabled: true, colour: "#a0641edc", widthZ18: 2 },
      road:     { enabled: true, colour: "#505050e6", widthZ18: 4 },
      building: { enabled: true, colour: "#a08c78c8", widthZ18: 2 },
      power:    { enabled: true, colour: "#c8a000c8", widthZ18: 1 },
      campsite: { enabled: true, colour: "#00a050e6", widthZ18: 14 },
      peak:     { enabled: true, colour: "#503214f0", widthZ18: 12 },
      spring:   { enabled: true, colour: "#1e5ad2e6", widthZ18: 8 },
      gate:     { enabled: true, colour: "#464646dc", widthZ18: 10 },
      cave:     { enabled: true, colour: "#3c1e0ae6", widthZ18: 10 },
      bridge:   { enabled: false, colour: "#403028e6", widthZ18: 3 },
      ford:     { enabled: false, colour: "#1e90ffe6", widthZ18: 8 },
      waterfall:{ enabled: false, colour: "#1e6ad2f0", widthZ18: 10 },
      trailhead:{ enabled: false, colour: "#a04020e6", widthZ18: 12 },
      viewpoint:{ enabled: false, colour: "#806020e6", widthZ18: 12 },
      hut:      { enabled: false, colour: "#503820e6", widthZ18: 12 },
    },
  },
};

// ---------------------------------------------------------------------------
// Validation (dep-free — frontend has no zod)
// ---------------------------------------------------------------------------

export interface ValidationOk {
  ok: true;
  value: TopoSettings;
}
export interface ValidationFail {
  ok: false;
  errors: string[];
}
export type ValidationResult = ValidationOk | ValidationFail;

const HEX_RGBA_RE = /^#[0-9a-fA-F]{8}$/;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function pushIf(errors: string[], cond: boolean, msg: string): boolean {
  if (!cond) errors.push(msg);
  return cond;
}

function inRange(n: unknown, lo: number, hi: number): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= lo && n <= hi;
}

const MAX_SLOPE_BANDS = 8;

export function validateTopoSettings(input: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isObject(input)) {
    return { ok: false, errors: ["root must be an object"] };
  }

  validateHillshade(input.hillshade, errors);
  validateSlope(input.slope, errors);
  validateVegetation(input.vegetation, errors);
  validateContours(input.contours, errors);
  validateFeatures(input.features, errors);

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: input as unknown as TopoSettings };
}

function validateHillshade(v: unknown, errors: string[]): void {
  if (!isObject(v)) { errors.push("hillshade must be an object"); return; }
  pushIf(errors, typeof v.enabled === "boolean", "hillshade.enabled must be boolean");
  pushIf(errors, typeof v.colour === "string" && HEX_RGBA_RE.test(v.colour as string), "hillshade.colour must be #RRGGBBAA");
  pushIf(errors, inRange(v.azimuth, 0, 360), "hillshade.azimuth must be 0..360");
  pushIf(errors, inRange(v.altitude, 0, 90), "hillshade.altitude must be 0..90");
  pushIf(errors, inRange(v.zFactor, 0.1, 10), "hillshade.zFactor must be 0.1..10");
  pushIf(errors, typeof v.multidirectional === "boolean", "hillshade.multidirectional must be boolean");
}

function validateSlope(v: unknown, errors: string[]): void {
  if (!isObject(v)) { errors.push("slope must be an object"); return; }
  pushIf(errors, typeof v.enabled === "boolean", "slope.enabled must be boolean");
  if (!Array.isArray(v.bands)) { errors.push("slope.bands must be array"); return; }
  if (v.bands.length > MAX_SLOPE_BANDS) {
    errors.push(`slope.bands max length is ${MAX_SLOPE_BANDS}`);
  }
  let prevTo = -Infinity;
  v.bands.forEach((band, i) => {
    if (!isObject(band)) { errors.push(`slope.bands[${i}] must be an object`); return; }
    const okFrom = pushIf(errors, inRange(band.fromDeg, 0, 90), `slope.bands[${i}].fromDeg must be 0..90`);
    const okTo = pushIf(errors, inRange(band.toDeg, 0, 90), `slope.bands[${i}].toDeg must be 0..90`);
    if (okFrom && okTo && (band.fromDeg as number) >= (band.toDeg as number)) {
      errors.push(`slope.bands[${i}] fromDeg must be < toDeg`);
    }
    if (okFrom && (band.fromDeg as number) < prevTo) {
      errors.push(`slope.bands[${i}] overlaps previous band`);
    }
    if (okTo) prevTo = band.toDeg as number;
    pushIf(errors, typeof band.colour === "string" && HEX_RGBA_RE.test(band.colour as string), `slope.bands[${i}].colour must be #RRGGBBAA`);
  });
}

function validateVegetation(v: unknown, errors: string[]): void {
  if (!isObject(v)) { errors.push("vegetation must be an object"); return; }
  pushIf(errors, typeof v.enabled === "boolean", "vegetation.enabled must be boolean");
  const okMin = pushIf(errors, inRange(v.minRatio, 0, 1), "vegetation.minRatio must be 0..1");
  const okMax = pushIf(errors, inRange(v.maxRatio, 0, 1), "vegetation.maxRatio must be 0..1");
  if (okMin && okMax && (v.minRatio as number) >= (v.maxRatio as number)) {
    errors.push("vegetation.minRatio must be < maxRatio");
  }
  pushIf(errors, typeof v.sparseColour === "string" && HEX_RGBA_RE.test(v.sparseColour as string), "vegetation.sparseColour must be #RRGGBBAA");
  pushIf(errors, typeof v.denseColour === "string" && HEX_RGBA_RE.test(v.denseColour as string), "vegetation.denseColour must be #RRGGBBAA");
  pushIf(errors, inRange(v.alphaMin, 0, 255), "vegetation.alphaMin must be 0..255");
  pushIf(errors, inRange(v.alphaMax, 0, 255), "vegetation.alphaMax must be 0..255");
  pushIf(errors, typeof v.weightsEnabled === "boolean", "vegetation.weightsEnabled must be boolean");
  if (!isObject(v.formationWeights)) {
    errors.push("vegetation.formationWeights must be an object");
  } else {
    for (const formation of SVTM_FORMATIONS) {
      const w = (v.formationWeights as Record<string, unknown>)[formation];
      pushIf(errors, inRange(w, 0, 5), `vegetation.formationWeights["${formation}"] must be 0..5`);
    }
  }
}

function validateContours(v: unknown, errors: string[]): void {
  if (!isObject(v)) { errors.push("contours must be an object"); return; }
  pushIf(errors, typeof v.enabled === "boolean", "contours.enabled must be boolean");
  if (!Array.isArray(v.zoomBands) || v.zoomBands.length !== 3) {
    errors.push("contours.zoomBands must be array of length 3");
  } else {
    v.zoomBands.forEach((band, i) => {
      if (!isObject(band)) { errors.push(`contours.zoomBands[${i}] must be an object`); return; }
      pushIf(errors, inRange(band.zoomMin, 0, 22), `contours.zoomBands[${i}].zoomMin must be 0..22`);
      pushIf(errors, inRange(band.zoomMax, 0, 22), `contours.zoomBands[${i}].zoomMax must be 0..22`);
      pushIf(errors, inRange(band.intervalM, 0.1, 5000), `contours.zoomBands[${i}].intervalM must be 0.1..5000`);
      pushIf(errors, inRange(band.majorEveryN, 1, 100) && Number.isInteger(band.majorEveryN), `contours.zoomBands[${i}].majorEveryN must be integer 1..100`);
    });
  }
  pushIf(errors, typeof v.majorColour === "string" && HEX_RGBA_RE.test(v.majorColour as string), "contours.majorColour must be #RRGGBBAA");
  pushIf(errors, typeof v.minorColour === "string" && HEX_RGBA_RE.test(v.minorColour as string), "contours.minorColour must be #RRGGBBAA");
  pushIf(errors, inRange(v.majorWidthM, 0, 200), "contours.majorWidthM must be 0..200");
  pushIf(errors, inRange(v.minorWidthM, 0, 200), "contours.minorWidthM must be 0..200");
}

function validateFeatures(v: unknown, errors: string[]): void {
  if (!isObject(v)) { errors.push("features must be an object"); return; }
  pushIf(errors, typeof v.enabled === "boolean", "features.enabled must be boolean");
  if (!isObject(v.features)) {
    errors.push("features.features must be an object");
    return;
  }
  for (const key of OSM_FEATURE_KEYS) {
    const style = (v.features as Record<string, unknown>)[key];
    if (!isObject(style)) { errors.push(`features.features.${key} must be an object`); continue; }
    pushIf(errors, typeof style.enabled === "boolean", `features.features.${key}.enabled must be boolean`);
    pushIf(errors, typeof style.colour === "string" && HEX_RGBA_RE.test(style.colour as string), `features.features.${key}.colour must be #RRGGBBAA`);
    pushIf(errors, inRange(style.widthZ18, 0, 100), `features.features.${key}.widthZ18 must be 0..100`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function parseRgbaHex(hex: RgbaHex): [number, number, number, number] {
  const m = HEX_RGBA_RE.exec(hex);
  if (!m) throw new Error(`Invalid RGBA hex: ${hex}`);
  const n = parseInt(hex.slice(1), 16);
  const r = (n >>> 24) & 0xff;
  const g = (n >>> 16) & 0xff;
  const b = (n >>> 8) & 0xff;
  const a = n & 0xff;
  return [r, g, b, a];
}

export function rgbaToHex(r: number, g: number, b: number, a: number): RgbaHex {
  const clip = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${clip(r)}${clip(g)}${clip(b)}${clip(a)}`;
}

// Deep clone via JSON. TopoSettings is plain JSON-safe data.
export function cloneTopoSettings(s: TopoSettings): TopoSettings {
  return JSON.parse(JSON.stringify(s)) as TopoSettings;
}
