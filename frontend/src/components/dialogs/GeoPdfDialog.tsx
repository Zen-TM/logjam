// Make a map. A GeoPDF, chosen on every open, is a printable map of one
// area, on one sheet of paper, at one scale: the form asks the paper and the
// scale, which size the area, then where it is, then what goes on top. For a
// GIS (GeoTIFF, GeoPackage, MBTiles) the area is a free box with no paper, and
// the file holds the statewide terrain over it (`AreaExportFields`).
//
// Nothing here is live — the paper is drawn on the map while you pick an area
// (App's frame), and everything else only matters once Make it renders it —
// so the whole dialog is one form with a Make it at the end, unlike the topo
// settings beside it (DESIGN.md).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TBbox } from "../map/Map";
import BasemapGallery from "../map/BasemapGallery";
import {
  PRINTABLE_BASE_LAYERS,
  seedBaseLayer,
  UNPRINTABLE_NOTE,
} from "./geoPdfBaseLayer";
import {
  contoursPrintedHere,
  hillshadeShadowedHere,
  LIDAR_ONLY_OVERLAYS,
  ownJobInArea,
  seedOverlays,
  shownOverlays,
} from "./geoPdfOverlays";
import type { CompletedTopoJob } from "../../topoLayerTypes";
import { apiFetch, type TPlace } from "../../placeUtils";
import { loadGeoPdfClient } from "./loadGeoPdfClient";
import { downloadBlob } from "../../download";
import { vegetationUrlsFor } from "./geoPdfVegetation";
import { messageFromError } from "../../errors/messageFromError";
import { useToast } from "../feedback/ToastProvider";
import { sanitizeDecimalInput } from "../../numberInput";
import {
  extentFieldErrors,
  extentFieldText,
  hasExtentFieldError,
  parseExtentField,
  scaleFieldError,
  type ExtentFieldErrors,
  type ExtentFieldKey,
  type ExtentFieldValues,
} from "./geoPdfExtentFields";
import type {
  SlopeBand,
  ExtentState,
  PaperSize,
  Orientation,
  CoordMode,
} from "@logjam/shared";
import {
  abandonConfirm,
  getPaperDimensions,
  getMapDimensions,
  GEOPDF_PADDING_MM,
  applyNorthChange,
  applySouthChange,
  applyEastChange,
  applyWestChange,
  applyScaleChange,
  applyPaperChange,
  applyOrientationChange,
  applyCoordModeChange,
  extentFromCentreAndSize,
} from "@logjam/shared";
import {
  AREA_EXPORT_FORMATS,
  AREA_EXPORT_LAYERS,
  AREA_EXPORT_LAYERS_BY_FORMAT,
  AREA_EXPORT_OUTSIDE_NSW,
  AREA_EXPORT_TOO_LARGE,
  areasInBox,
  areaExportTooLarge,
  areaInNsw,
  areaSizeKm,
  EXPORT_FORMAT_LABELS,
  geoPdfTooLarge,
  GEOPDF_TOO_LARGE,
  MAP_TERRAIN,
  type AreaExportFormat,
  type AreaExportLayer,
  type SharpenedArea,
  TERRAIN_LAYER_KEYS,
  type GeoPdfConfig,
  type TerrainLayerKey,
} from "@logjam/shared";
import { useStoredState } from "../../useStoredState";
import {
  GEOPDF_SETTINGS_KEY,
  readSettings,
  settingsOf,
} from "./geoPdfSettings";
import { buildPlaceMarkers } from "./geoPdfPlaceMarkers";
import {
  SCALE_PRESETS,
  sheetSizeLabel,
  scaleChoice,
  type ScaleChoice,
} from "./geoPdfArea";
import {
  Button,
  IconButton,
  Checkbox,
  ChipPicker,
  ChipRail,
  Dialog,
  SectionHeader,
  SettingsRow,
  TextField,
  type ChipOption,
  ErrorBanner,
  FieldError,
  ProgressBar,
} from "../../ui";
import type { GeoPdfProgress } from "../../geoPdf/client";
import classes from "./GeoPdfDialog.module.css";

// ── Types ────────────────────────────────────────────────────────────────────

// ── Constants ────────────────────────────────────────────────────────────────

const PAPER_SIZES: PaperSize[] = ["A2", "A3", "A4", "A5", "custom"];
const PAPER_OPTIONS: ChipOption<PaperSize>[] = PAPER_SIZES.map((size) => ({
  value: size,
  label: size === "custom" ? "Custom" : size,
}));

const ORIENTATION_OPTIONS: ChipOption<Orientation>[] = [
  { value: "portrait", label: "Portrait" },
  { value: "landscape", label: "Landscape" },
];

const SCALE_OPTIONS: ChipOption<ScaleChoice>[] = [
  ...SCALE_PRESETS.map((scale) => ({
    value: `${scale}` as ScaleChoice,
    label: `1:${scale.toLocaleString()}`,
  })),
  { value: "other", label: "Other" },
];

/** What is made: a GeoPDF, or one of the area formats for GIS. */
type FormatChoice = "geopdf" | AreaExportFormat;

const FORMAT_OPTIONS: ChipOption<FormatChoice>[] = [
  { value: "geopdf", label: "GeoPDF" },
  ...AREA_EXPORT_FORMATS.map((format) => ({
    value: format,
    label: EXPORT_FORMAT_LABELS[format],
  })),
];

const GIS_FORMAT_NOTES: Record<AreaExportFormat, string> = {
  geotiff:
    "A .zip of rasters in GDA2020 / MGA, for QGIS or ArcGIS: heights in metres, slope in degrees, and hillshade.",
  gpkg: "One file for QGIS: the rasters in GDA2020 / MGA, and the contours as lines that carry their height.",
  mbtiles:
    "Map data for Gaia, Locus or OruxMaps, drawn over their own map, with slope in your slope bands as they are now.",
};

const COORD_OPTIONS: ChipOption<CoordMode>[] = [
  { value: "latlon", label: "Lat/Lon" },
  { value: "enNorthing", label: "E/N" },
];

// Land tenure is a Terrain layer to the map's stacking but an overlay to the
// user, in the layers control and here: who holds the land is no part of the
// shape of the ground (`MAP_TERRAIN`).
const SHAPE_KEYS = TERRAIN_LAYER_KEYS.filter((key) => key !== "land");

// The Overlays group's chips that are not layers of the map.
const MY_PLACES = "my-places";
const SHARED_PLACES = "shared-places";
const SHARED_PLACES_HINT =
  "Shared places are ones a friend shared with you, not with whoever you hand the PDF to.";

const COORD_TOOLTIP =
  "Lat/Lon is what a GPS shows you. E/N is the MGA2020 grid, the one printed on NSW topo maps.";
const SCALE_TOOLTIP = `1:${(25000).toLocaleString()} means 1 cm on the paper is 250 m on the ground.`;

const DEFAULT_EXTENT_STATE: ExtentState = {
  paperSize: "A4",
  orientation: "portrait",
  north: 0,
  south: 0,
  east: 0,
  west: 0,
  scale: 25000,
  coordMode: "latlon",
};

// ── Component ────────────────────────────────────────────────────────────────

const RENDER_FAILED =
  "Couldn't make the GeoPDF. Check your connection, or try another base map.";

const PHASE_TEXT: Record<GeoPdfProgress["phase"], string> = {
  preparing: "Getting the map ready.",
  drawing: "Drawing the map.",
  finishing: "Putting the PDF together.",
};

/** How long the area, scale and layers stand still before tiles are prefetched. */
const PREFETCH_AFTER_MS = 1000;
const NO_AREA = { north: 0, south: 0, east: 0, west: 0 };

/** The sheet's area re-centred on a point, at its current paper and scale. */
function centredOn(
  prev: ExtentState,
  center: { lat: number; lng: number },
): ExtentState {
  const paper = getPaperDimensions(prev);
  const widthM = prev.scale * ((paper.w - 2 * GEOPDF_PADDING_MM) / 1000);
  const heightM = prev.scale * ((paper.h - 2 * GEOPDF_PADDING_MM) / 1000);
  return {
    ...prev,
    ...extentFromCentreAndSize(center.lat, center.lng, widthM, heightM),
  };
}

function GeoPdfDialog({
  open,
  onClose,
  onSelectOnMap,
  pendingExtent,
  pendingScale,
  activeLayerId,
  terrainLayers,
  completedTopoJobs,
  mapCenter,
  places,
  sharedPlaces,
  slopeBands,
  topoJobsLoaded = true,
  areaSeed,
  onPickArea,
  pendingArea,
  onExportQueued,
  sharpenedAreas = [],
}: {
  open: boolean;
  onClose: () => void;
  onSelectOnMap: (
    paperAspectRatio: number,
    paperDimensions: { w: number; h: number },
    initialExtent?: TBbox,
    initialScale?: number,
    /** The base layer chosen here, for the map to show while the area is
     *  framed. */
    baseLayerId?: string,
  ) => void;
  pendingExtent: TBbox | null;
  pendingScale: number | null;
  activeLayerId: string;
  /** The map's Terrain switches, which a new GeoPDF's overlays start from. */
  terrainLayers: Readonly<Record<TerrainLayerKey, boolean>>;
  completedTopoJobs: CompletedTopoJob[];
  mapCenter?: { lat: number; lng: number; zoom: number } | null;
  places?: TPlace[];
  sharedPlaces?: TPlace[];
  /** The account's slope bands, as the map draws the statewide slope. */
  slopeBands: readonly SlopeBand[];
  /** Whether `completedTopoJobs` has settled: a render waits for it, so a
   *  sharpened area is never left off for being slow to load. */
  topoJobsLoaded?: boolean;
  /** The box this opening was given (a selection's, a topo's footprint), which
   *  a GIS format's area starts from. */
  areaSeed?: TBbox | null;
  /** Leave to draw a GIS format's box on the map. */
  onPickArea?: () => void;
  /** The box drawn on the map, handed back. */
  pendingArea?: TBbox | null;
  onExportQueued?: () => void;
  /** The sharpened areas this user may read, which a GIS file includes
   *  where they fall inside its box (the API decides the same at submit). */
  sharpenedAreas?: readonly SharpenedArea[];
}) {
  // ── State ────────────────────────────────────────────────────────────────

  const toast = useToast();

  const [extentState, setExtentState] =
    useState<ExtentState>(DEFAULT_EXTENT_STATE);

  // Layers
  const [selectedBaseLayer, setSelectedBaseLayer] = useState(() =>
    seedBaseLayer(activeLayerId),
  );
  const [selectedOverlays, setSelectedOverlays] =
    useState<Set<string>>(seedOverlays);
  // Until the user ticks or unticks a Terrain layer, or applies remembered
  // settings that did (`shownOverlays`).
  const [terrainFollowsMap, setTerrainFollowsMap] = useState(true);

  // Map elements
  const [titleEnabled, setTitleEnabled] = useState(false);
  const [titleText, setTitleText] = useState("");
  // The file name and the title follow each other until both are typed in:
  // `touched` is whether the user has typed in one, so a field they have not
  // touched shows the other's text.
  const [fileText, setFileText] = useState("");
  const [titleTouched, setTitleTouched] = useState(false);
  const [fileTouched, setFileTouched] = useState(false);
  const [compassEnabled, setCompassEnabled] = useState(true);
  const [scaleTextEnabled, setScaleTextEnabled] = useState(true);
  const [scaleBarEnabled, setScaleBarEnabled] = useState(true);
  const [gridLinesEnabled, setGridLinesEnabled] = useState(false);
  const [gridLinesMode, setGridLinesMode] = useState<CoordMode>("latlon");

  // Last settings: remembered when a GeoPDF is made, never its title or area.
  const [stored, setStored] = useStoredState<unknown>(
    GEOPDF_SETTINGS_KEY,
    null,
  );

  // Place overlays. Persisted so a deliberate opt-in survives reopen.
  // Shared places default OFF: a friend consented to in-app
  // viewing, not to being named on a printable artifact — opt-in only.
  const [showOwnedPlacesOnPdf, setShowOwnedPlacesOnPdf] = useStoredState(
    "logjam.geoPdf.showOwnedPlaces",
    true,
  );
  const [showSharedPlacesOnPdf, setShowSharedPlacesOnPdf] = useStoredState(
    "logjam.geoPdf.showSharedPlaces",
    false,
  );

  // What is made: a GeoPDF on every open (the render test "opens on GeoPDF").
  const [format, setFormat] = useState<FormatChoice>("geopdf");
  // A GIS format's box, once drawn or typed; until then it starts from the
  // opening's box, else the GeoPDF's.
  const [gisBox, setGisBox] = useState<TBbox | null>(null);
  const [gisLayers, setGisLayers] = useState<ReadonlySet<AreaExportLayer>>(
    () => new Set(AREA_EXPORT_LAYERS),
  );
  // Its typed edges, held here so Make it can refuse an edge that shows an
  // error, and whether they are the view showing.
  const gisFocused = useRef<"n" | "s" | "e" | "w" | "scale" | null>(null);
  const [gisRaw, setGisRaw] = useState<ExtentFieldValues>(NO_EDGES_TYPED);
  const [gisCoordsOpen, setGisCoordsOpen] = useState(false);
  // The box was drawn on the map, not seeded or typed.
  const [gisPicked, setGisPicked] = useState(false);
  // Make it was pressed with something missing: a requirement shows from then
  // on, where a limit shows live (shared/DESIGN.md §11).
  const [gisTried, setGisTried] = useState(false);

  // Generation
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set while a GeoPDF renders in this tab; aborting it is what Cancel does.
  const [progress, setProgress] = useState<GeoPdfProgress | null>(null);
  const renderAbort = useRef<AbortController | null>(null);

  // Unsaved-changes tracking. Explicit dirty flag (not snapshot-diffing) —
  // state here is seeded by three programmatic writers at unpredictable
  // times (open-time map-view seed, the stored-settings apply, the map
  // round-trip reopen), so a diff-against-baseline approach would false-
  // positive on every seed. Only handlers that represent a direct user
  // interaction with the form set this; programmatic seeds/resets never do.
  const [dirty, setDirty] = useState(false);
  const markDirty = useCallback(() => setDirty(true), []);

  // Set when the dialog closes for "Select on map": that close is a round trip,
  // so the close keeps state and the per-session init guards instead of
  // resetting them. Cleared when the dialog reopens.
  const [returningFromMapSelect, setReturningFromMapSelect] = useState(false);

  // Per-session init guard. The last settings and the map-view seed fill the
  // dialog ONCE per genuine open; after that the user is free to edit fields and
  // those edits must survive (e.g. across a "Select on map" round trip) until the
  // dialog is genuinely closed. Reset only in the genuine-close branch below.
  const [seededView, setSeededView] = useState(false);

  // Raw string state for extent/scale inputs (deferred recalculation)
  const focusedField = useRef<"n" | "s" | "e" | "w" | "scale" | null>(null);
  const [rawN, setRawN] = useState("");
  const [rawS, setRawS] = useState("");
  const [rawE, setRawE] = useState("");
  const [rawW, setRawW] = useState("");
  const [rawScale, setRawScale] = useState("");
  // Other was pressed: its field stays open even at a preset's number.
  const [scaleOtherPicked, setScaleOtherPicked] = useState(false);
  // The coordinates start folded away on every open; Make it opens them when a
  // field there needs fixing, so the field the banner points at can be seen.
  const [coordsOpen, setCoordsOpen] = useState(false);
  // The area was framed on the map, not only seeded from where it was looking.
  const [areaPicked, setAreaPicked] = useState(false);

  // The last settings, applied over the form once per genuine open. A field
  // the stored value lacks keeps the seed already set.
  function applyLastSettings() {
    const c = readSettings(
      stored,
      PRINTABLE_BASE_LAYERS.map((layer) => layer.id),
    );
    setExtentState((prev: ExtentState) => {
      let updated = {
        ...prev,
        ...(c.paperSize ? { paperSize: c.paperSize } : {}),
        ...(c.orientation ? { orientation: c.orientation } : {}),
      };
      if (c.paperSize)
        updated = applyPaperChange(updated, c.paperSize, c.customRatio);
      if (c.scale !== undefined) updated = applyScaleChange(updated, c.scale);
      return updated;
    });
    if (c.baseLayer)
      setSelectedBaseLayer(seedBaseLayer(activeLayerId, c.baseLayer));
    if (c.overlays) setSelectedOverlays(new Set(c.overlays));
    if (c.terrainPinned) setTerrainFollowsMap(false);
    if (c.compass !== undefined) setCompassEnabled(c.compass);
    if (c.scaleText !== undefined) setScaleTextEnabled(c.scaleText);
    if (c.scaleBar !== undefined) setScaleBarEnabled(c.scaleBar);
    if (c.gridLines !== undefined) {
      setGridLinesEnabled(c.gridLines !== null);
      if (c.gridLines) setGridLinesMode(c.gridLines);
    }
  }

  // ── Open and close ───────────────────────────────────────────────────────
  // Steps that follow props, run during render in this order (the order the
  // effects they replaced ran in): the open/close transition, then a
  // confirmed map pick.

  // On a genuine close, reset everything; the map round-trip close keeps it.
  // On open, seed layers + extent from the current map view, once per genuine
  // open: the seededView gate skips re-seeding on the map round trip, so user
  // edits survive. mapCenter and activeLayerId are read here, at open time,
  // and are not triggers: they change reference on map move and topo-job
  // polling.
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setReturningFromMapSelect(false);
      if (!seededView) {
        setSeededView(true);
        setFormat("geopdf");
        setSelectedBaseLayer(seedBaseLayer(activeLayerId));
        setSelectedOverlays(seedOverlays());
        setTerrainFollowsMap(true);
        applyLastSettings();
        const center = mapCenter;
        if (center) setExtentState((prev) => centredOn(prev, center));
      }
    } else if (!returningFromMapSelect) {
      setSeededView(false);
      setExtentState(DEFAULT_EXTENT_STATE);
      setTitleEnabled(false);
      setTitleText("");
      setFileText("");
      setTitleTouched(false);
      setFileTouched(false);
      setCompassEnabled(true);
      setScaleTextEnabled(true);
      setScaleBarEnabled(true);
      setGridLinesEnabled(false);
      setGridLinesMode("latlon");
      // Place-marker toggles are deliberately NOT reset — they persist via
      // localStorage so the user's explicit choice carries across sessions.
      setError(null);
      setRawN("");
      setRawS("");
      setRawE("");
      setRawW("");
      setRawScale("");
      setScaleOtherPicked(false);
      setCoordsOpen(false);
      setAreaPicked(false);
      setGisBox(null);
      setGisLayers(new Set(AREA_EXPORT_LAYERS));
      setGisRaw(NO_EDGES_TYPED);
      setGisCoordsOpen(false);
      setGisPicked(false);
      setGisTried(false);
      setDirty(false);
    }
  }

  // Populate extent from map selection — always receives both extent and scale.
  // A pick is not marked dirty: it is one tap to redo, and a form with nothing
  // else touched closes without asking.
  const [pendingAppliedFor, setPendingAppliedFor] = useState({
    pendingExtent: null as TBbox | null,
    pendingScale: null as number | null,
  });
  if (
    pendingExtent !== pendingAppliedFor.pendingExtent ||
    !Object.is(pendingScale, pendingAppliedFor.pendingScale)
  ) {
    setPendingAppliedFor({ pendingExtent, pendingScale });
    if (pendingExtent && pendingScale) {
      setExtentState((prev: ExtentState) => ({
        ...prev,
        north: pendingExtent.north,
        south: pendingExtent.south,
        east: pendingExtent.east,
        west: pendingExtent.west,
        scale: pendingScale,
      }));
      setAreaPicked(true);
      setCoordsOpen(false);
    }
  }

  // The box drawn for a GIS format, as the extent above.
  const [pendingAreaAppliedFor, setPendingAreaAppliedFor] = useState<
    TBbox | null | undefined
  >(null);
  if (pendingArea !== pendingAreaAppliedFor) {
    setPendingAreaAppliedFor(pendingArea);
    if (pendingArea) {
      setGisBox(pendingArea);
      setGisPicked(true);
      setGisCoordsOpen(false);
    }
  }

  // ── Effects ──────────────────────────────────────────────────────────────

  // LiDAR layers are offered where one of the user's jobs lies in the area.
  const lidarOverlap = useMemo(
    () => ownJobInArea(completedTopoJobs, extentState),
    [completedTopoJobs, extentState],
  );
  // Why a Terrain chip is off on this sheet, as the sentence the group's hint
  // says, or null when it is on offer.
  const offReason = (key: TerrainLayerKey): string | null =>
    key === "contours" && contoursPrintedHere(selectedBaseLayer, lidarOverlap)
      ? "This map prints its own contours."
      : key === "hillshade" && hillshadeShadowedHere(selectedBaseLayer)
        ? `${MAP_TERRAIN.copy.hillshadeImagery}.`
        : null;
  const overlays = useMemo(
    () =>
      shownOverlays(
        selectedOverlays,
        terrainFollowsMap,
        terrainLayers,
        lidarOverlap,
      ),
    [selectedOverlays, terrainFollowsMap, terrainLayers, lidarOverlap],
  );

  // Sync raw strings from extentState whenever extentState changes,
  // but only for fields the user is not currently editing.
  useEffect(() => {
    if (focusedField.current !== "n")
      setRawN(extentFieldText("n", extentState));
    if (focusedField.current !== "s")
      setRawS(extentFieldText("s", extentState));
    if (focusedField.current !== "e")
      setRawE(extentFieldText("e", extentState));
    if (focusedField.current !== "w")
      setRawW(extentFieldText("w", extentState));
    if (focusedField.current !== "scale")
      setRawScale(String(Math.round(extentState.scale)));
  }, [extentState]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleSelectOnMap = useCallback(() => {
    const paper = getPaperDimensions(extentState);
    const mapW = paper.w - 2 * GEOPDF_PADDING_MM;
    const mapH = paper.h - 2 * GEOPDF_PADDING_MM;
    const aspectRatio = mapW / mapH;
    const hasValidExtent =
      extentState.north !== 0 &&
      extentState.south !== 0 &&
      extentState.east !== 0 &&
      extentState.west !== 0 &&
      extentState.north > extentState.south &&
      extentState.east > extentState.west;
    setReturningFromMapSelect(true);
    onSelectOnMap(
      aspectRatio,
      { w: mapW, h: mapH },
      hasValidExtent
        ? {
            north: extentState.north,
            south: extentState.south,
            east: extentState.east,
            west: extentState.west,
          }
        : undefined,
      extentState.scale,
      selectedBaseLayer,
    );
  }, [extentState, onSelectOnMap, selectedBaseLayer]);

  const extentValid =
    extentState.north > extentState.south &&
    extentState.east > extentState.west &&
    extentState.scale > 0;

  // Inline validation of the raw extent/scale inputs. A field left
  // in an invalid state (non-numeric, out of range, North not above South,
  // East not right of West) shows a FieldError and blocks Generate rather
  // than discarding the input while displaying it.
  const extentInputErrors = extentFieldErrors(
    { n: rawN, s: rawS, e: rawE, w: rawW },
    extentState,
  );
  const scaleInputError = scaleFieldError(rawScale);
  // A limit shows live (shared/DESIGN.md §11), in the API's own words.
  const tooLarge =
    extentValid &&
    geoPdfTooLarge(extentState, extentState.scale, selectedBaseLayer);

  const gisArea =
    gisBox ??
    areaSeed ??
    (extentValid
      ? {
          north: extentState.north,
          south: extentState.south,
          east: extentState.east,
          west: extentState.west,
        }
      : null);
  const gisFormat = format === "geopdf" ? null : format;
  // A limit, or a box with no size (two clicks on one spot), shows live.
  const gisAreaLimit = !gisArea
    ? null
    : gisArea.north <= gisArea.south || gisArea.east <= gisArea.west
      ? "That box has no size. Draw it again on the map."
      : areaExportTooLarge(gisArea)
        ? AREA_EXPORT_TOO_LARGE
        : !areaInNsw(gisArea)
          ? AREA_EXPORT_OUTSIDE_NSW
          : null;
  const gisEdges = {
    ...(gisArea ?? NO_AREA),
    coordMode: extentState.coordMode,
  };
  const gisAreaSet = gisArea !== null;
  // The typed edges follow the box, except the one being typed in.
  useEffect(() => {
    setGisRaw((previous) => {
      const next = { ...previous };
      for (const which of ["n", "s", "e", "w"] as const)
        if (gisFocused.current !== which)
          next[which] = gisArea ? extentFieldText(which, gisEdges) : "";
      return next;
    });
    // The box's numbers, not its object, which is rebuilt every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    gisAreaSet,
    gisEdges.north,
    gisEdges.south,
    gisEdges.east,
    gisEdges.west,
    gisEdges.coordMode,
  ]);
  const gisEdgeErrors = gisArea
    ? extentFieldErrors(gisRaw, gisEdges)
    : NO_EDGE_ERRORS;
  const gisChosenLayers = gisFormat
    ? AREA_EXPORT_LAYERS_BY_FORMAT[gisFormat].filter((layer) =>
        gisLayers.has(layer),
      )
    : [];

  const handleExportArea = async () => {
    const edgeError = hasExtentFieldError(gisEdgeErrors);
    if (
      !gisFormat ||
      !gisArea ||
      gisAreaLimit ||
      edgeError ||
      gisChosenLayers.length === 0
    ) {
      setGisTried(true);
      if (edgeError) {
        setGisCoordsOpen(true);
        setGisPicked(false);
      }
      setError("A field below needs fixing first.");
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      await apiFetch("/topo-exports", {
        method: "POST",
        body: { bbox: gisArea, layers: gisChosenLayers, format: gisFormat },
      });
      toast.done(
        "Making your map. It comes to your Inbox, and downloads itself if this tab is still open.",
      );
      onExportQueued?.();
      onClose();
    } catch (e) {
      console.error(e);
      setError(messageFromError(e, "Couldn't queue the map. Try again."));
    } finally {
      setGenerating(false);
    }
  };

  // What a GeoPDF draws over its base sheet. A hillshade chosen on another
  // sheet is kept, not drawn over imagery.
  const printedOverlays = useMemo(
    () =>
      [...overlays]
        .filter(
          (id) =>
            id !== "hillshade" || !hillshadeShadowedHere(selectedBaseLayer),
        )
        .map((id) =>
          id.startsWith("master-") ? id.slice("master-".length) : id,
        ),
    [overlays, selectedBaseLayer],
  );

  // Warm the persistent tile cache while the dialog is open: once the area,
  // scale and layers have stood still for a second, the statewide tiles this
  // print reads are fetched in the background, so Make it often starts warm.
  // It stops the moment anything changes, Make it is pressed or the dialog
  // closes, so it never competes with a render. Never a third-party tile.
  const stopPrefetch = useRef<(() => void) | null>(null);
  const prefetching =
    open && format === "geopdf" && !generating && extentValid && !tooLarge;
  useEffect(() => {
    if (!prefetching) return;
    // Cleanup can run while the client chunk is still loading: a prefetch
    // started after that would have nobody left to stop it.
    let cancelled = false;
    const timer = setTimeout(() => {
      loadGeoPdfClient()
        .then((client) => {
          if (cancelled) return;
          stopPrefetch.current = client.prefetchGeoPdf({
            config: {
              paperSize: extentState.paperSize,
              orientation: extentState.orientation,
              ...(extentState.customRatio
                ? { customRatio: extentState.customRatio }
                : {}),
              extent: {
                north: extentState.north,
                south: extentState.south,
                east: extentState.east,
                west: extentState.west,
              },
              scale: extentState.scale,
              baseLayer: selectedBaseLayer,
              overlays: printedOverlays,
              elements: { compass: false, scaleText: false, scaleBar: false },
            },
            slopeBands,
            areas: completedTopoJobs.flatMap((job) => job.sharpened ?? []),
            vegetationUrls: [],
            origin: location.origin,
          });
        })
        .catch(() => {});
    }, PREFETCH_AFTER_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      stopPrefetch.current?.();
      stopPrefetch.current = null;
    };
  }, [
    prefetching,
    extentState,
    selectedBaseLayer,
    printedOverlays,
    slopeBands,
    completedTopoJobs,
  ]);

  const titleShown = titleTouched ? titleText : fileTouched ? fileText : "";
  // The file name is only what was typed there; empty, the download takes
  // the title's (the renderer's fallback) and the placeholder says so.
  const fileDefault = (titleEnabled && titleShown.trim()) || "logjam-geopdf";

  const handleGenerate = useCallback(async () => {
    if (
      !extentValid ||
      hasExtentFieldError(extentInputErrors) ||
      scaleInputError !== null ||
      tooLarge
    ) {
      if (!extentValid || hasExtentFieldError(extentInputErrors)) {
        setCoordsOpen(true);
        setAreaPicked(false);
      }
      setError("A field below needs fixing first.");
      return;
    }
    // A prefetch must not share the link with the render it was meant to help.
    stopPrefetch.current?.();
    stopPrefetch.current = null;
    setGenerating(true);
    setError(null);
    const config: GeoPdfConfig = {
      paperSize: extentState.paperSize,
      orientation: extentState.orientation,
      ...(extentState.customRatio
        ? { customRatio: extentState.customRatio }
        : {}),
      extent: {
        north: extentState.north,
        south: extentState.south,
        east: extentState.east,
        west: extentState.west,
      },
      scale: extentState.scale,
      baseLayer: selectedBaseLayer,
      overlays: printedOverlays,
      elements: {
        ...(titleEnabled ? { title: titleShown } : {}),
        compass: compassEnabled,
        scaleText: scaleTextEnabled,
        scaleBar: scaleBarEnabled,
        ...(gridLinesEnabled ? { gridLines: gridLinesMode } : {}),
      },
    };

    // Build place markers from places within the current extent. Shared
    // places are opt-in only — boundary enforced and tested in
    // buildPlaceMarkers.
    const markers = buildPlaceMarkers(places, sharedPlaces, config.extent, {
      includeOwned: showOwnedPlacesOnPdf,
      includeShared: showSharedPlacesOnPdf,
    });
    if (markers.length > 0) {
      config.placeMarkers = markers;
    }

    const controller = new AbortController();
    renderAbort.current = controller;
    setProgress({ phase: "preparing", done: 0, total: 0, fraction: 0 });
    try {
      const { renderGeoPdf } = await loadGeoPdfClient();
      const result = await renderGeoPdf(
        {
          config,
          slopeBands,
          areas: completedTopoJobs.flatMap((job) => job.sharpened ?? []),
          vegetationUrls: vegetationUrlsFor(completedTopoJobs, config.extent),
          origin: location.origin,
          fileName: fileText.trim() || undefined,
        },
        { onProgress: setProgress, signal: controller.signal },
      );
      if (result.ok) {
        downloadBlob(result.pdf, result.fileName);
        setStored(
          settingsOf(config, {
            overlays: selectedOverlays,
            terrainPinned: !terrainFollowsMap,
          }),
        );
        toast.done("Your GeoPDF is downloading.");
        onClose();
      } else if (result.reason === "too-large") {
        setError(GEOPDF_TOO_LARGE);
      } else if (result.reason === "failed") {
        setError(RENDER_FAILED);
      }
    } catch (e) {
      console.error(e);
      setError(RENDER_FAILED);
    } finally {
      renderAbort.current = null;
      setProgress(null);
      setGenerating(false);
    }
  }, [
    extentState,
    selectedBaseLayer,
    printedOverlays,
    titleEnabled,
    titleShown,
    fileText,
    compassEnabled,
    scaleTextEnabled,
    scaleBarEnabled,
    gridLinesEnabled,
    gridLinesMode,
    // The place-marker inputs must be included so toggling Shared places OFF
    // updates the callback before Generate runs, preserving the privacy boundary.
    places,
    sharedPlaces,
    showOwnedPlacesOnPdf,
    showSharedPlacesOnPdf,
    slopeBands,
    completedTopoJobs,
    setStored,
    selectedOverlays,
    terrainFollowsMap,
    toast,
    onClose,
    extentValid,
    extentInputErrors,
    scaleInputError,
    tooLarge,
  ]);

  const toggleOverlay = useCallback(
    (name: string) => {
      const next = new Set(overlays);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      setSelectedOverlays(next);
      if ((TERRAIN_LAYER_KEYS as readonly string[]).includes(name))
        setTerrainFollowsMap(false);
      setDirty(true);
    },
    [overlays],
  );

  // The renderer is its own chunk: start fetching it on open, so Make it
  // doesn't wait. A failure here resurfaces when Make it imports it again.
  useEffect(() => {
    if (open) loadGeoPdfClient().catch(() => {});
  }, [open]);
  // Closing the dialog, however it closes, ends a render in progress.
  useEffect(() => {
    if (!open) renderAbort.current?.abort();
  }, [open]);
  useEffect(() => () => renderAbort.current?.abort(), []);

  // ── Render ───────────────────────────────────────────────────────────────

  const mapMm = getMapDimensions(extentState);

  return (
    <>
      <Dialog
        open={open}
        title="Make a map"
        size="large"
        dismissible={!generating}
        onClose={onClose}
        // "Select on map" and a successful Generate call onClose directly, so
        // neither asks.
        discard={dirty ? abandonConfirm("map", true) : null}
        footer={(requestClose) => (
          <>
            <Button
              onClick={requestClose}
              disabled={generating}
              disabledReason="Making it…"
            >
              Cancel
            </Button>
            <Button
              variant="filled"
              busy={generating || (!gisFormat && !topoJobsLoaded)}
              onClick={gisFormat ? handleExportArea : handleGenerate}
            >
              Make it
            </Button>
          </>
        )}
      >
        <div className={classes.form}>
          <p className={classes.wideHint}>This is easier on a bigger screen.</p>

          {error && <ErrorBanner message={error} />}

          <section className={classes.group}>
            <SectionHeader title="Format" />
            <ChipRail
              label="Format"
              className={classes.railCell}
              options={FORMAT_OPTIONS}
              value={format}
              onChange={(next) => {
                setFormat(next);
                setError(null);
              }}
              hint={gisFormat ? GIS_FORMAT_NOTES[gisFormat] : undefined}
            />
          </section>

          {gisFormat ? (
            <AreaExportFields
              format={gisFormat}
              area={gisArea}
              areaError={
                gisAreaLimit ??
                (gisTried && !gisArea ? "Pick an area on the map." : null)
              }
              edges={gisEdges}
              raw={gisRaw}
              onDraft={(which, value) => {
                setGisRaw((previous) => ({ ...previous, [which]: value }));
                markDirty();
              }}
              edgeErrors={gisEdgeErrors}
              focusedFieldRef={gisFocused}
              coordsOpen={gisCoordsOpen}
              onToggleCoords={() => {
                setGisCoordsOpen(!gisCoordsOpen);
                setGisPicked(false);
              }}
              onClear={() => {
                setGisBox(null);
                setGisRaw(NO_EDGES_TYPED);
                setGisPicked(false);
                markDirty();
              }}
              onCoordModeChange={(coordMode) => {
                // The text moves with the mode (see the GeoPDF chip).
                if (gisArea)
                  setGisRaw({
                    n: extentFieldText("n", { ...gisArea, coordMode }),
                    s: extentFieldText("s", { ...gisArea, coordMode }),
                    e: extentFieldText("e", { ...gisArea, coordMode }),
                    w: extentFieldText("w", { ...gisArea, coordMode }),
                  });
                setExtentState(applyCoordModeChange(extentState, coordMode));
              }}
              onAreaChange={(area) => {
                setGisBox(area);
                markDirty();
              }}
              picked={gisPicked}
              onPick={() => {
                setReturningFromMapSelect(true);
                onPickArea?.();
              }}
              layers={gisLayers}
              onToggleLayer={(layer) => {
                const next = new Set(gisLayers);
                if (next.has(layer)) next.delete(layer);
                else next.add(layer);
                setGisLayers(next);
                markDirty();
              }}
              noLayers={gisTried && gisChosenLayers.length === 0}
              sharpenedInside={
                gisArea ? areasInBox(sharpenedAreas, gisArea).length : 0
              }
            />
          ) : (
            <>
              {/* Paper, orientation and scale set the area's size; the map sets
              where it is. */}
              <section className={classes.group}>
                <SectionHeader title="Area" />
                <SettingsRow label="Paper">
                  <ChipRail
                    label="Paper size"
                    className={classes.railCell}
                    options={PAPER_OPTIONS}
                    value={extentState.paperSize}
                    onChange={(size) => {
                      setExtentState(applyPaperChange(extentState, size));
                      markDirty();
                    }}
                  />
                </SettingsRow>
                <SettingsRow
                  label="Orientation"
                  disabled={extentState.paperSize === "custom"}
                  disabledReason="A custom ratio sets its own shape."
                >
                  <ChipRail
                    label="Orientation"
                    className={classes.railCell}
                    options={ORIENTATION_OPTIONS}
                    value={extentState.orientation}
                    onChange={(orientation) => {
                      setExtentState(
                        applyOrientationChange(extentState, orientation),
                      );
                      markDirty();
                    }}
                  />
                </SettingsRow>
                {extentState.paperSize === "custom" && (
                  <SettingsRow
                    label="Ratio"
                    tooltip="Width against height, in whatever units. A4 is 210 by 297."
                  >
                    <div className={classes.ratioRow}>
                      <TextField
                        label="Ratio width"
                        hideLabel
                        className={classes.ratioField}
                        type="text"
                        inputMode="decimal"
                        value={String(extentState.customRatio?.w ?? 210)}
                        onChange={(event) => {
                          const w =
                            parseFloat(
                              sanitizeDecimalInput(event.target.value),
                            ) || 1;
                          const h = extentState.customRatio?.h ?? 297;
                          setExtentState(
                            applyPaperChange(extentState, "custom", { w, h }),
                          );
                          markDirty();
                        }}
                      />
                      <span aria-hidden>:</span>
                      <TextField
                        label="Ratio height"
                        hideLabel
                        className={classes.ratioField}
                        type="text"
                        inputMode="decimal"
                        value={String(extentState.customRatio?.h ?? 297)}
                        onChange={(event) => {
                          const h =
                            parseFloat(
                              sanitizeDecimalInput(event.target.value),
                            ) || 1;
                          const w = extentState.customRatio?.w ?? 210;
                          setExtentState(
                            applyPaperChange(extentState, "custom", { w, h }),
                          );
                          markDirty();
                        }}
                      />
                    </div>
                  </SettingsRow>
                )}
                <SettingsRow label="Scale" tooltip={SCALE_TOOLTIP}>
                  <ChipRail
                    label="Scale"
                    wrap
                    className={classes.railCell}
                    options={SCALE_OPTIONS}
                    value={scaleChoice(extentState.scale, scaleOtherPicked)}
                    onChange={(choice) => {
                      setScaleOtherPicked(choice === "other");
                      if (choice !== "other")
                        setExtentState(
                          applyScaleChange(extentState, Number(choice)),
                        );
                      markDirty();
                    }}
                  />
                </SettingsRow>
                {/* Under the rail, not beside it: beside it, the field squeezes
                the presets into a scroll at a phone's width. */}
                {scaleChoice(extentState.scale, scaleOtherPicked) ===
                  "other" && (
                  <div className={classes.scaleRow}>
                    <span className={classes.scalePrefix} aria-hidden>
                      1 :
                    </span>
                    <TextField
                      label="Scale"
                      hideLabel
                      className={classes.scaleField}
                      type="text"
                      inputMode="numeric"
                      value={rawScale}
                      onFocus={() => {
                        focusedField.current = "scale";
                      }}
                      onChange={(event) => {
                        setRawScale(sanitizeDecimalInput(event.target.value));
                        markDirty();
                      }}
                      onBlur={() => {
                        focusedField.current = null;
                        const value = Number(rawScale);
                        if (scaleInputError === null && Number.isFinite(value))
                          setExtentState((s: ExtentState) =>
                            applyScaleChange(s, value),
                          );
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                      }}
                    />
                  </div>
                )}
                <FieldError message={scaleInputError} />

                <AreaRow
                  size={sheetSizeLabel(
                    (extentState.scale * mapMm.w) / 1000,
                    (extentState.scale * mapMm.h) / 1000,
                  )}
                  picked={areaPicked}
                  onPick={handleSelectOnMap}
                  coordsOpen={coordsOpen}
                  onToggleCoords={() => {
                    setCoordsOpen(!coordsOpen);
                    setAreaPicked(false);
                  }}
                  onClear={() => {
                    setAreaPicked(false);
                    setExtentState((prev) =>
                      mapCenter
                        ? centredOn(prev, mapCenter)
                        : { ...prev, ...NO_AREA },
                    );
                    markDirty();
                  }}
                />
                {coordsOpen && (
                  <div className={classes.group}>
                    <SettingsRow label="Coordinates" tooltip={COORD_TOOLTIP}>
                      <ChipRail
                        label="Coordinates"
                        className={classes.railCell}
                        options={COORD_OPTIONS}
                        value={extentState.coordMode}
                        onChange={(coordMode) => {
                          const next = applyCoordModeChange(
                            extentState,
                            coordMode,
                          );
                          // The text moves with the mode, not in the effect after it, or a
                          // render checks metres as degrees.
                          setRawN(extentFieldText("n", next));
                          setRawS(extentFieldText("s", next));
                          setRawE(extentFieldText("e", next));
                          setRawW(extentFieldText("w", next));
                          setExtentState(next);
                        }}
                      />
                    </SettingsRow>
                    {/* The four edges laid out where they are on the map. Typing one moves the box, and the other three follow. */}
                    <div className={classes.extentGrid}>
                      <div className={classes.extentNorth}>
                        <ExtentField
                          which="n"
                          label={
                            extentState.coordMode === "latlon"
                              ? "North"
                              : "N (northing)"
                          }
                          value={rawN}
                          error={extentInputErrors.n}
                          focusedFieldRef={focusedField}
                          onDraft={setRawN}
                          onCommit={(deg) =>
                            setExtentState((s) => applyNorthChange(s, deg))
                          }
                          parse={(raw) =>
                            parseExtentField("n", raw, extentState)
                          }
                          valid={extentInputErrors.n === null}
                          markDirty={markDirty}
                        />
                      </div>
                      <div className={classes.extentWest}>
                        <ExtentField
                          which="w"
                          label={
                            extentState.coordMode === "latlon"
                              ? "West"
                              : "W (easting)"
                          }
                          value={rawW}
                          error={extentInputErrors.w}
                          focusedFieldRef={focusedField}
                          onDraft={setRawW}
                          onCommit={(deg) =>
                            setExtentState((s) => applyWestChange(s, deg))
                          }
                          parse={(raw) =>
                            parseExtentField("w", raw, extentState)
                          }
                          valid={extentInputErrors.w === null}
                          markDirty={markDirty}
                        />
                      </div>
                      <div className={classes.extentEast}>
                        <ExtentField
                          which="e"
                          label={
                            extentState.coordMode === "latlon"
                              ? "East"
                              : "E (easting)"
                          }
                          value={rawE}
                          error={extentInputErrors.e}
                          focusedFieldRef={focusedField}
                          onDraft={setRawE}
                          onCommit={(deg) =>
                            setExtentState((s) => applyEastChange(s, deg))
                          }
                          parse={(raw) =>
                            parseExtentField("e", raw, extentState)
                          }
                          valid={extentInputErrors.e === null}
                          markDirty={markDirty}
                        />
                      </div>
                      <div className={classes.extentSouth}>
                        <ExtentField
                          which="s"
                          label={
                            extentState.coordMode === "latlon"
                              ? "South"
                              : "S (northing)"
                          }
                          value={rawS}
                          error={extentInputErrors.s}
                          focusedFieldRef={focusedField}
                          onDraft={setRawS}
                          onCommit={(deg) =>
                            setExtentState((s) => applySouthChange(s, deg))
                          }
                          parse={(raw) =>
                            parseExtentField("s", raw, extentState)
                          }
                          valid={extentInputErrors.s === null}
                          markDirty={markDirty}
                        />
                      </div>
                    </div>
                  </div>
                )}
                <FieldError message={tooLarge ? GEOPDF_TOO_LARGE : null} />
              </section>

              <section className={classes.group}>
                <SectionHeader title="Layers" />
                <div className={classes.baseLayer}>
                  <span className={classes.baseLayerLabel}>Base layer</span>
                  <BasemapGallery
                    label="Base layer"
                    layers={PRINTABLE_BASE_LAYERS}
                    activeLayerId={selectedBaseLayer}
                    onChange={(id) => {
                      setSelectedBaseLayer(id);
                      markDirty();
                    }}
                    mapView={mapCenter ?? null}
                    oneRow
                  />
                  {UNPRINTABLE_NOTE && (
                    <p className={classes.note}>{UNPRINTABLE_NOTE}</p>
                  )}
                </div>
                <ChipPicker
                  label={MAP_TERRAIN.title}
                  options={SHAPE_KEYS.map((key) => ({
                    value: key,
                    label: MAP_TERRAIN.copy[key],
                    disabled: offReason(key) !== null,
                  }))}
                  selected={SHAPE_KEYS.filter(
                    (key) => offReason(key) === null && overlays.has(key),
                  )}
                  onToggle={toggleOverlay}
                  hint={
                    SHAPE_KEYS.map(offReason).filter(Boolean).join(" ") ||
                    undefined
                  }
                />
                <ChipPicker
                  label="Overlays"
                  options={[
                    ...(lidarOverlap ? LIDAR_ONLY_OVERLAYS : []).map(
                      (layer) => ({
                        value: layer.name,
                        label: layer.label,
                      }),
                    ),
                    { value: MY_PLACES, label: "My places" },
                    { value: SHARED_PLACES, label: "Shared places" },
                    { value: "land", label: MAP_TERRAIN.copy.land },
                  ]}
                  selected={[
                    ...(lidarOverlap ? LIDAR_ONLY_OVERLAYS : [])
                      .map((layer) => layer.name)
                      .filter((name) => overlays.has(name)),
                    ...(showOwnedPlacesOnPdf ? [MY_PLACES] : []),
                    ...(showSharedPlacesOnPdf ? [SHARED_PLACES] : []),
                    ...(overlays.has("land") ? ["land"] : []),
                  ]}
                  onToggle={(value) => {
                    if (value === MY_PLACES)
                      setShowOwnedPlacesOnPdf(!showOwnedPlacesOnPdf);
                    else if (value === SHARED_PLACES)
                      setShowSharedPlacesOnPdf(!showSharedPlacesOnPdf);
                    else toggleOverlay(value);
                  }}
                  hint={SHARED_PLACES_HINT}
                />
              </section>

              <section className={classes.group}>
                <SectionHeader title="Map elements" />
                <div className={classes.checkList}>
                  <div className={classes.elementRow}>
                    <Checkbox
                      label="Title"
                      checked={titleEnabled}
                      onChange={(next) => {
                        setTitleEnabled(next);
                        markDirty();
                      }}
                    />
                    {titleEnabled && (
                      <TextField
                        label="Map title"
                        hideLabel
                        className={classes.elementField}
                        placeholder="Map title"
                        value={titleShown}
                        onChange={(event) => {
                          setTitleText(event.target.value);
                          setTitleTouched(true);
                          markDirty();
                        }}
                      />
                    )}
                  </div>

                  <Checkbox
                    label="North arrow (TN / GN / MN)"
                    checked={compassEnabled}
                    onChange={(next) => {
                      setCompassEnabled(next);
                      markDirty();
                    }}
                  />

                  <div className={classes.elementRow}>
                    <Checkbox
                      label="Scale text"
                      checked={scaleTextEnabled}
                      onChange={(next) => {
                        setScaleTextEnabled(next);
                        markDirty();
                      }}
                    />
                    {scaleTextEnabled && (
                      <span className={classes.elementSuffix}>
                        1:{Math.round(extentState.scale).toLocaleString()}
                      </span>
                    )}
                  </div>

                  <Checkbox
                    label="Scale bar"
                    checked={scaleBarEnabled}
                    onChange={(next) => {
                      setScaleBarEnabled(next);
                      markDirty();
                    }}
                  />

                  <div className={classes.elementRow}>
                    <Checkbox
                      label="Grid lines"
                      checked={gridLinesEnabled}
                      onChange={(next) => {
                        setGridLinesEnabled(next);
                        markDirty();
                      }}
                    />
                    {gridLinesEnabled && (
                      <ChipRail
                        label="Grid lines"
                        className={classes.railCell}
                        options={COORD_OPTIONS}
                        value={gridLinesMode}
                        onChange={(mode) => {
                          setGridLinesMode(mode);
                          markDirty();
                        }}
                      />
                    )}
                  </div>
                </div>
                <TextField
                  label="File name"
                  hint="Optional. Empty, it is the title when there is one. .pdf is added."
                  placeholder={fileDefault}
                  value={fileText}
                  onChange={(event) => {
                    setFileText(event.target.value);
                    setFileTouched(true);
                    markDirty();
                  }}
                />
              </section>
            </>
          )}
        </div>
      </Dialog>

      <Dialog
        open={progress !== null}
        title="Making your GeoPDF"
        onClose={() => renderAbort.current?.abort()}
        footer={
          <Button onClick={() => renderAbort.current?.abort()}>Cancel</Button>
        }
      >
        {progress && (
          <div className={classes.progress}>
            <ProgressBar
              label="Making your GeoPDF"
              value={progress.fraction * 100}
            />
            <p className={classes.note}>
              <span role="status">{PHASE_TEXT[progress.phase]}</span>{" "}
              {Math.round(progress.fraction * 100)}%
            </p>
          </div>
        )}
      </Dialog>
    </>
  );
}

/**
 * The Area row: its size, then the two ways to set it. Pick on the map leaves
 * for the map and takes the accent once the area was picked there; Type the
 * coordinates takes it while the edges are open beneath the row. They are one
 * choice: the parent un-picks when the edges open and closes them on a pick.
 */
function AreaRow({
  size,
  picked,
  onPick,
  coordsOpen,
  onToggleCoords,
  onClear,
}: {
  size: string;
  picked: boolean;
  onPick: () => void;
  coordsOpen: boolean;
  onToggleCoords: () => void;
  onClear: () => void;
}) {
  return (
    <SettingsRow label="Area">
      <div className={classes.areaCell}>
        <span className={classes.areaSize}>{size}</span>
        <Button
          icon="pickArea"
          compact
          variant={picked ? "filled" : "outline"}
          onClick={onPick}
        >
          Pick on the map
        </Button>
        {picked && (
          <IconButton
            icon="close"
            label="Clear the picked area"
            size={14}
            onClick={onClear}
          />
        )}
        <Button
          compact
          variant={coordsOpen ? "filled" : "outline"}
          aria-expanded={coordsOpen}
          onClick={onToggleCoords}
        >
          Type the coordinates
        </Button>
      </div>
    </SettingsRow>
  );
}

/**
 * One edge of the extent. The typing is held here and only a VALID number is
 * applied, so a half-finished coordinate stays on screen under its own error
 * instead of being silently discarded; leaving the field with a good
 * one commits it, and Enter is the same as leaving.
 */
function ExtentField({
  which,
  label,
  value,
  error,
  focusedFieldRef,
  onDraft,
  onCommit,
  parse,
  valid,
  markDirty,
}: {
  which: "n" | "s" | "e" | "w";
  label: string;
  value: string;
  error: string | null;
  focusedFieldRef: React.RefObject<"n" | "s" | "e" | "w" | "scale" | null>;
  onDraft: (next: string) => void;
  onCommit: (degrees: number) => void;
  parse: (raw: string) => number | null;
  valid: boolean;
  markDirty: () => void;
}) {
  return (
    <TextField
      label={label}
      className={classes.extentField}
      type="text"
      inputMode="decimal"
      value={value}
      error={error}
      onFocus={() => {
        focusedFieldRef.current = which;
      }}
      onChange={(event) => {
        onDraft(sanitizeDecimalInput(event.target.value));
        markDirty();
      }}
      onBlur={() => {
        focusedFieldRef.current = null;
        const degrees = parse(value);
        if (degrees !== null && valid) onCommit(degrees);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}

const LAYER_LABELS: Record<AreaExportLayer, string> = {
  heights: "Heights",
  slope: MAP_TERRAIN.copy.slope,
  hillshade: MAP_TERRAIN.copy.hillshade,
  contours: MAP_TERRAIN.copy.contours,
};

const EDGE_FIELDS: {
  which: ExtentFieldKey;
  cell: keyof typeof classes;
  latlon: string;
  en: string;
}[] = [
  { which: "n", cell: "extentNorth", latlon: "North", en: "N (northing)" },
  { which: "w", cell: "extentWest", latlon: "West", en: "W (easting)" },
  { which: "e", cell: "extentEast", latlon: "East", en: "E (easting)" },
  { which: "s", cell: "extentSouth", latlon: "South", en: "S (northing)" },
];

const NO_EDGES_TYPED: ExtentFieldValues = { n: "", s: "", e: "", w: "" };
const NO_EDGE_ERRORS: ExtentFieldErrors = {
  n: null,
  s: null,
  e: null,
  w: null,
};

const EDGE_OF: Record<ExtentFieldKey, keyof TBbox> = {
  n: "north",
  s: "south",
  e: "east",
  w: "west",
};

/**
 * A GIS format's area and layers. The area is a free box, drawn on the map or
 * typed edge by edge, so there is no paper or scale; its size shows,
 * never its corners (shared/DESIGN.md §13).
 */
function AreaExportFields({
  format,
  area,
  areaError,
  edges,
  raw,
  onDraft,
  edgeErrors,
  focusedFieldRef,
  coordsOpen,
  onToggleCoords,
  onClear,
  onCoordModeChange,
  onAreaChange,
  onPick,
  picked,
  layers,
  onToggleLayer,
  noLayers,
  sharpenedInside,
}: {
  format: AreaExportFormat;
  area: TBbox | null;
  areaError: string | null;
  edges: TBbox & { coordMode: CoordMode };
  raw: ExtentFieldValues;
  onDraft: (which: ExtentFieldKey, value: string) => void;
  edgeErrors: ExtentFieldErrors;
  focusedFieldRef: React.RefObject<"n" | "s" | "e" | "w" | "scale" | null>;
  coordsOpen: boolean;
  onToggleCoords: () => void;
  onClear: () => void;
  onCoordModeChange: (mode: CoordMode) => void;
  onAreaChange: (area: TBbox) => void;
  onPick: () => void;
  picked: boolean;
  layers: ReadonlySet<AreaExportLayer>;
  onToggleLayer: (layer: AreaExportLayer) => void;
  noLayers: boolean;
  sharpenedInside: number;
}) {
  const { coordMode } = edges;
  const size = area ? areaSizeKm(area) : null;

  return (
    <>
      <section className={classes.group}>
        <SectionHeader title="Area" />
        <AreaRow
          size={
            size
              ? sheetSizeLabel(size.widthKm * 1000, size.heightKm * 1000)
              : "None yet"
          }
          picked={picked}
          onPick={onPick}
          coordsOpen={coordsOpen}
          onToggleCoords={onToggleCoords}
          onClear={onClear}
        />
        <FieldError message={areaError} />
        {coordsOpen && (
          <div className={classes.group}>
            <SettingsRow label="Coordinates" tooltip={COORD_TOOLTIP}>
              <ChipRail
                label="Coordinates"
                className={classes.railCell}
                options={COORD_OPTIONS}
                value={coordMode}
                onChange={onCoordModeChange}
              />
            </SettingsRow>
            <div className={classes.extentGrid}>
              {EDGE_FIELDS.map((field) => (
                <div key={field.which} className={classes[field.cell]}>
                  <ExtentField
                    which={field.which}
                    label={coordMode === "latlon" ? field.latlon : field.en}
                    value={raw[field.which]}
                    error={edgeErrors[field.which]}
                    focusedFieldRef={focusedFieldRef}
                    onDraft={(next) => onDraft(field.which, next)}
                    onCommit={(degrees) =>
                      onAreaChange({
                        ...(area ?? NO_AREA),
                        [EDGE_OF[field.which]]: degrees,
                      })
                    }
                    parse={(value) =>
                      parseExtentField(field.which, value, edges)
                    }
                    valid={!hasExtentFieldError(edgeErrors)}
                    markDirty={() => {}}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className={classes.group}>
        <SectionHeader title="Layers" />
        <ChipPicker
          label="Include"
          options={AREA_EXPORT_LAYERS_BY_FORMAT[format].map((layer) => ({
            value: layer,
            label: LAYER_LABELS[layer],
          }))}
          selected={AREA_EXPORT_LAYERS_BY_FORMAT[format].filter((layer) =>
            layers.has(layer),
          )}
          onToggle={(layer) => onToggleLayer(layer as AreaExportLayer)}
          error={noLayers ? "Pick at least one layer." : null}
        />
        {sharpenedInside > 0 && (
          <p className={classes.note}>
            {sharpenedInside === 1
              ? "1 sharpened area inside is included, at its own detail."
              : `${sharpenedInside} sharpened areas inside are included, at their own detail.`}
          </p>
        )}
        {/* No number until computeEstimate has an area-export kind. */}
        <p className={classes.note}>
          Its time and credits aren't known until it has run; it's charged for
          the time it takes.
        </p>
        <p className={classes.note}>
          It comes to your Inbox, and downloads itself if this tab is still
          open. Map files are kept for 7 days.
        </p>
        <p className={classes.note}>
          What comes out is drawn from the government's survey, and it may be
          wrong or out of date. Don't rely on it in place of your own
          navigation, judgement or rescue planning.
        </p>
      </section>
    </>
  );
}

export default GeoPdfDialog;
