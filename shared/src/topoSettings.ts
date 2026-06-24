// Topo generation render settings.
//
// As of Stage 1, settings are split into two slices:
//
//   RasterTemplateSettings — persisted on TopoTemplate.config. Drives raster
//     bake (hillshade tint, vegetation colors, slope bins, contour interval
//     bands at composite-bake time). Selected per-job via the template picker.
//
//   VectorStyleSettings — persisted on User.vectorStyle (one active style per
//     user). Drives both (a) the live MapLibre paint expressions on vector
//     PMTiles in-app and (b) the per-job composite raster bake. Snapshotted
//     into TopoJob.vectorStyleSnapshot at job-submit time so the composite
//     reflects the style at submission, while in-app paint always reflects
//     the live user value.
//
// Frontend, API, and worker all import these types + validators from here.

// ---------------------------------------------------------------------------
// Topo layers — canonical list (ARCH-010)
// ---------------------------------------------------------------------------
// The single source of truth for the layers rendered on the map and selectable
// as GeoPDF overlays. Composite is intentionally absent — it's MBTiles-only
// (email download), not a map layer. Everything TS-side derives from this list
// (TopoLayerKey, RASTER_LAYERS/VECTOR_LAYERS in topoExport.ts, the GeoPDF
// overlay allowlist); api/src/constants/topoLayers.ts and
// frontend/src/topoLayerTypes.ts are thin re-exports. The only structurally
// unavoidable mirror is topo/worker.py → ALL_LAYERS (Python).

export const TOPO_LAYERS = [
  { name: "hillshade", label: "Hillshade", format: "raster" },
  { name: "vegetation", label: "Vegetation", format: "raster" },
  { name: "slope", label: "Slope", format: "raster" },
  { name: "contours", label: "Contours", format: "vector" },
  { name: "features", label: "Features", format: "vector" },
] as const;

export type TopoLayerMeta = (typeof TOPO_LAYERS)[number];
// Derived from the list so the union and the list cannot diverge.
export type TopoLayerKey = TopoLayerMeta["name"];
// Alias kept for call sites that grew up on the api/frontend constant files.
export type TopoLayerName = TopoLayerKey;
export type TopoLayerFormat = TopoLayerMeta["format"];

export type RgbaHex = string; // #RRGGBBAA, lowercase hex

// ---------------------------------------------------------------------------
// Raster template slice
// ---------------------------------------------------------------------------

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

// Raster-bake-only contour fields. Vector contour colors/widths live in
// VectorStyleSettings now and apply at composite-bake time via the snapshot.
export interface RasterContoursSettings {
  enabled: boolean;
  zoomBands: ContourZoomBand[];   // length 3, indices/zooms fixed
}

// Raster-bake-only OSM features toggle. Per-category fields live in
// VectorStyleSettings.
export interface RasterFeaturesSettings {
  enabled: boolean;
}

export interface RasterTemplateSettings {
  hillshade: HillshadeSettings;
  slope: SlopeSettings;
  vegetation: VegetationSettings;
  contours: RasterContoursSettings;
  features: RasterFeaturesSettings;
}

// ---------------------------------------------------------------------------
// Vector style slice (per-user, live)
// ---------------------------------------------------------------------------

export type OsmFeatureKey =
  | "waterway" | "track" | "road" | "building" | "power"
  | "campsite" | "peak" | "spring" | "gate" | "cave"
  | "bridge" | "ford" | "waterfall" | "trailhead" | "viewpoint" | "hut";

// Per-category vector style. `enabled` controls both paint-time layer presence
// in-app and composite-bake-time inclusion. Worker always fetches all
// categories from Overpass unconditionally.
export interface OsmFeatureStyle {
  enabled: boolean;
  colour: RgbaHex;
  widthZ18: number;   // applies to line/point styling; >= 0
}

export interface VectorContoursStyle {
  majorColour: RgbaHex;
  minorColour: RgbaHex;
  majorWidthM: number;  // line thickness in ground metres
  minorWidthM: number;
}

export interface VectorStyleSettings {
  contours: VectorContoursStyle;
  features: Record<OsmFeatureKey, OsmFeatureStyle>;
  // Global multiplier on the label text-size ramp (contour elevations + feature
  // names) across the live map and baked exports. 1 = the default 9px@z14→12px@z18.
  labelScale: number;
}

// Label-size multiplier bounds — shared by the frontend slider and the validator.
export const LABEL_SCALE_MIN = 0.5;
export const LABEL_SCALE_MAX = 2;

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

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const RASTER_TEMPLATE_DEFAULTS: RasterTemplateSettings = {
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
  },
  features: {
    enabled: true,
  },
};

export const VECTOR_STYLE_DEFAULTS: VectorStyleSettings = {
  contours: {
    majorColour: "#503c28dc",
    minorColour: "#785a3ca0",
    majorWidthM: 18,
    minorWidthM: 8,
  },
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
  labelScale: 1,
};

// ---------------------------------------------------------------------------
// Validation (dep-free — frontend has no zod)
// ---------------------------------------------------------------------------

export interface ValidationOk<T> {
  ok: true;
  value: T;
}
export interface ValidationFail {
  ok: false;
  errors: string[];
}
export type ValidationResult<T> = ValidationOk<T> | ValidationFail;

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

export function validateRasterTemplateSettings(input: unknown): ValidationResult<RasterTemplateSettings> {
  const errors: string[] = [];
  if (!isObject(input)) {
    return { ok: false, errors: ["root must be an object"] };
  }

  validateHillshade(input.hillshade, errors);
  validateSlope(input.slope, errors);
  validateVegetation(input.vegetation, errors);
  validateRasterContours(input.contours, errors);
  validateRasterFeatures(input.features, errors);

  if (errors.length > 0) return { ok: false, errors };
  // Each sub-validator above has confirmed its field's full shape, so a single
  // narrowing cast per field is sound (no `as unknown` escape hatch). TS now
  // checks that every interface member is accounted for here.
  const value: RasterTemplateSettings = {
    hillshade: input.hillshade as HillshadeSettings,
    slope: input.slope as SlopeSettings,
    vegetation: input.vegetation as VegetationSettings,
    contours: input.contours as RasterContoursSettings,
    features: input.features as RasterFeaturesSettings,
  };
  return { ok: true, value };
}

export function validateVectorStyleSettings(input: unknown): ValidationResult<VectorStyleSettings> {
  const errors: string[] = [];
  if (!isObject(input)) {
    return { ok: false, errors: ["root must be an object"] };
  }

  validateVectorContours(input.contours, errors);
  validateVectorFeatures(input.features, errors);

  // labelScale is a later addition: pre-existing stored styles omit it, so an
  // absent value is valid and normalises to 1. A present value must be in range.
  if (input.labelScale !== undefined) {
    pushIf(errors, inRange(input.labelScale, LABEL_SCALE_MIN, LABEL_SCALE_MAX),
      `labelScale must be ${LABEL_SCALE_MIN}..${LABEL_SCALE_MAX}`);
  }

  if (errors.length > 0) return { ok: false, errors };
  const value: VectorStyleSettings = {
    contours: input.contours as VectorContoursStyle,
    features: input.features as Record<OsmFeatureKey, OsmFeatureStyle>,
    labelScale: input.labelScale === undefined ? 1 : (input.labelScale as number),
  };
  return { ok: true, value };
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

function validateRasterContours(v: unknown, errors: string[]): void {
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
}

function validateRasterFeatures(v: unknown, errors: string[]): void {
  if (!isObject(v)) { errors.push("features must be an object"); return; }
  pushIf(errors, typeof v.enabled === "boolean", "features.enabled must be boolean");
}

function validateVectorContours(v: unknown, errors: string[]): void {
  if (!isObject(v)) { errors.push("contours must be an object"); return; }
  pushIf(errors, typeof v.majorColour === "string" && HEX_RGBA_RE.test(v.majorColour as string), "contours.majorColour must be #RRGGBBAA");
  pushIf(errors, typeof v.minorColour === "string" && HEX_RGBA_RE.test(v.minorColour as string), "contours.minorColour must be #RRGGBBAA");
  pushIf(errors, inRange(v.majorWidthM, 0, 200), "contours.majorWidthM must be 0..200");
  pushIf(errors, inRange(v.minorWidthM, 0, 200), "contours.minorWidthM must be 0..200");
}

function validateVectorFeatures(v: unknown, errors: string[]): void {
  if (!isObject(v)) {
    errors.push("features must be an object");
    return;
  }
  for (const key of OSM_FEATURE_KEYS) {
    const style = (v as Record<string, unknown>)[key];
    if (!isObject(style)) { errors.push(`features.${key} must be an object`); continue; }
    pushIf(errors, typeof style.enabled === "boolean", `features.${key}.enabled must be boolean`);
    pushIf(errors, typeof style.colour === "string" && HEX_RGBA_RE.test(style.colour as string), `features.${key}.colour must be #RRGGBBAA`);
    pushIf(errors, inRange(style.widthZ18, 0, 100), `features.${key}.widthZ18 must be 0..100`);
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

export function cloneRasterTemplateSettings(s: RasterTemplateSettings): RasterTemplateSettings {
  return JSON.parse(JSON.stringify(s)) as RasterTemplateSettings;
}

export function cloneVectorStyleSettings(s: VectorStyleSettings): VectorStyleSettings {
  return JSON.parse(JSON.stringify(s)) as VectorStyleSettings;
}

// ---------------------------------------------------------------------------
// Vector paint helpers (shared by the live MapLibre overlay and the GeoPDF
// canvas renderer so both stay in lockstep — single source of truth for the
// colour + width math).
// ---------------------------------------------------------------------------

/** #RRGGBBAA → `rgba(r,g,b,a)` CSS string (alpha 0..1). */
export function rgbaCssFromHex(hex: RgbaHex): string {
  const [r, g, b, a] = parseRgbaHex(hex);
  return `rgba(${r},${g},${b},${(a / 255).toFixed(3)})`;
}

/** Zoom stops {z12, z18} for a contour width given in ground metres. */
export function contourWidthStops(widthM: number): { z12: number; z18: number } {
  const w18 = widthM / 8;
  return { z12: Math.max(0.3, w18 * 0.4), z18: w18 };
}

/** Zoom stops {z12, z18} for a line feature width given in pixels at z18. */
export function featureLineWidthStops(widthZ18: number): { z12: number; z18: number } {
  return { z12: Math.max(0.25, widthZ18 * 0.25), z18: widthZ18 };
}

/**
 * Point-evaluate a linear z12→z18 interpolation at an arbitrary zoom (clamped
 * to the [12, 18] domain). Mirrors the MapLibre `["interpolate", ["linear"],
 * ["zoom"], 12, z12, 18, z18]` expression for use in the canvas renderer.
 */
export function lerpZoom(zoom: number, z12: number, z18: number): number {
  const t = Math.max(0, Math.min(1, (zoom - 12) / (18 - 12)));
  return z12 + t * (z18 - z12);
}

// ---------------------------------------------------------------------------
// Point-feature icons. Source of truth for filename + size is the Python
// pipeline (topo/pipeline.py OSM_STYLE_META); mirrored here so the web map
// and GeoPDF render the same icons at the same size as the MBTiles export.
// Icons are non-recolourable PNGs (24×24 native), so point categories carry no
// user colour/width override for the glyph itself.
// ---------------------------------------------------------------------------

export const OSM_POINT_ICON: Record<OsmPointFeatureKey, { file: string; sizeZ18: number }> = {
  campsite:  { file: "campsite.png",  sizeZ18: 20 },
  peak:      { file: "peak.png",      sizeZ18: 18 },
  spring:    { file: "spring.png",    sizeZ18: 18 },
  gate:      { file: "gate.png",      sizeZ18: 18 },
  cave:      { file: "cave.png",      sizeZ18: 18 },
  ford:      { file: "ford.png",      sizeZ18: 20 },
  waterfall: { file: "waterfall.png", sizeZ18: 20 },
  trailhead: { file: "trailhead.png", sizeZ18: 20 },
  viewpoint: { file: "viewpoint.png", sizeZ18: 20 },
  hut:       { file: "hut.png",       sizeZ18: 20 },
};

/** Natural pixel dimension of every point icon PNG. */
export const OSM_POINT_ICON_NATURAL_PX = 24;

/**
 * On-screen icon edge length in pixels at a given zoom. Mirrors the Python
 * sizing law `max(12, round(size_z18 * (zoom / 18) ** 0.5))`.
 */
export function iconTargetPx(sizeZ18: number, zoom: number): number {
  return Math.max(12, Math.round(sizeZ18 * Math.pow(zoom / 18, 0.5)));
}
