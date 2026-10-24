// Export an area. A GeoPDF, chosen on every open, is a printable map of one
// area, on one sheet of paper, at one scale: the form asks the paper and the
// scale, which size the area, then where it is, then what goes on top. For a
// GIS (GeoTIFF, GeoPackage, MBTiles) the area is a free box with no paper, and
// the file holds the statewide terrain over it (`AreaExportFields`).
//
// Nothing here is live — the paper is drawn on the map while you pick an area
// (App's frame), and everything else only matters once the worker renders it —
// so the whole dialog is one form with a Make it at the end, unlike the topo
// settings beside it (DESIGN.md).
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { TBbox } from "../map/Map";
import { BASE_LAYER_OPTIONS, seedBaseLayer } from "./geoPdfBaseLayer";
import {
  contoursPrintedHere,
  LIDAR_ONLY_OVERLAYS,
  ownJobInArea,
  seedOverlays,
  shownOverlays,
} from "./geoPdfOverlays";
import type { CompletedTopoJob } from "../../topoLayerTypes";
import { apiFetch, type TPlace, type GeoPdfJobView } from "../../placeUtils";
import { messageFromError } from "../../errors/messageFromError";
import { useToast } from "../feedback/ToastProvider";
import { useUnsavedChangesGuard } from "../../useUnsavedChangesGuard";
import ConfirmDialog from "./ConfirmDialog";
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
  ExtentState,
  PaperSize,
  Orientation,
  CoordMode,
  PivotPoint,
} from "@logjam/shared";
import {
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
  applyPivotChange,
  applyCoordModeChange,
  extentFromCentreAndSize,
} from "@logjam/shared";
import {
  AREA_EXPORT_FORMATS,
  AREA_EXPORT_LAYERS,
  AREA_EXPORT_LAYERS_BY_FORMAT,
  AREA_EXPORT_OUTSIDE_NSW,
  AREA_EXPORT_TOO_LARGE,
  areaExportTooLarge,
  areaInNsw,
  areaSizeKm,
  EXPORT_FORMAT_LABELS,
  geoPdfTooLarge,
  GEOPDF_TOO_LARGE,
  MAP_TERRAIN,
  type AreaExportFormat,
  type AreaExportLayer,
  TERRAIN_LAYER_KEYS,
  type GeoPdfConfig,
  type TerrainLayerKey,
} from "@logjam/shared";
import { useStoredState } from "../../useStoredState";
import { buildPlaceMarkers } from "./geoPdfPlaceMarkers";
import {
  SCALE_PRESETS,
  sheetSizeLabel,
  scaleChoice,
  type ScaleChoice,
} from "./geoPdfArea";
import {
  Button,
  Checkbox,
  ChipRail,
  Dialog,
  InfoTip,
  SectionHeader,
  Select,
  SettingsRow,
  TextField,
  type ChipOption,
  ErrorBanner,
  FieldError,
} from "../../ui";
import classes from "./GeoPdfDialog.module.css";

// ── Types ────────────────────────────────────────────────────────────────────

export type GeoPdfTemplateConfig = Omit<GeoPdfConfig, "extent"> & {
  scale?: number;
};

export type GeoPdfTemplate = {
  id: string;
  name: string;
  config: GeoPdfTemplateConfig;
  createdAt: string;
  updatedAt: string;
};

// ── Constants ────────────────────────────────────────────────────────────────

const PAPER_SIZES: PaperSize[] = ["A2", "A3", "A4", "A5", "custom"];
// The pivot's nine points, in reading order, with the name a reader hears:
// the grid SHOWS which corner is anchored, so the words are the control's
// accessible name rather than a caption under it (DESIGN.md).
const PIVOT_POINTS: { value: PivotPoint; label: string }[] = [
  { value: "tl", label: "Top left" },
  { value: "tc", label: "Top centre" },
  { value: "tr", label: "Top right" },
  { value: "ml", label: "Middle left" },
  { value: "mc", label: "Centre" },
  { value: "mr", label: "Middle right" },
  { value: "bl", label: "Bottom left" },
  { value: "bc", label: "Bottom centre" },
  { value: "br", label: "Bottom right" },
];

const PAPER_OPTIONS: ChipOption<PaperSize>[] = PAPER_SIZES.map((size) => ({
  value: size,
  label: size === "custom" ? "Custom" : size,
}));

const ORIENTATION_OPTIONS: ChipOption<Orientation>[] = [
  { value: "portrait", label: "Portrait" },
  { value: "landscape", label: "Landscape" },
];

// The lock only decides what typing an edge does, so it is named for that.
const LOCK_OPTIONS: ChipOption<ExtentState["lockMode"]>[] = [
  { value: "scale", label: "Moves the box" },
  { value: "position", label: "Resizes it" },
];

const SCALE_OPTIONS: ChipOption<ScaleChoice>[] = [
  ...SCALE_PRESETS.map((scale) => ({
    value: `${scale}` as ScaleChoice,
    label: `1:${scale.toLocaleString()}`,
  })),
  { value: "other", label: "Other" },
];

/** What is made: a GeoPDF, or under For GIS one of the area formats. */
type FormatChoice = "geopdf" | AreaExportFormat;

const GEOPDF_OPTION: ChipOption<FormatChoice>[] = [
  { value: "geopdf", label: "GeoPDF" },
];

const GIS_OPTIONS: ChipOption<FormatChoice>[] = AREA_EXPORT_FORMATS.map(
  (format) => ({
    value: format,
    label: EXPORT_FORMAT_LABELS[format],
  }),
);

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

const LOCK_TOOLTIP =
  "Moves the box keeps the scale; Resizes it keeps the opposite edge and changes the scale.";
const COORD_TOOLTIP =
  "Lat/Lon is what a GPS shows you. E/N is the MGA2020 grid, the one printed on NSW topo maps.";
const PIVOT_TOOLTIP =
  "The part of the box that stays put while the rest of it moves.";
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
  lockMode: "scale",
  pivot: "mc",
};

// ── Component ────────────────────────────────────────────────────────────────

const NO_AREA = { north: 0, south: 0, east: 0, west: 0 };

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
  templateMode,
  editingTemplate,
  onTemplateSaved,
  initialTemplateId,
  onJobQueued,
  openWithGis,
  areaSeed,
  onPickArea,
  pendingArea,
  onExportQueued,
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
  mapCenter?: { lat: number; lng: number } | null;
  places?: TPlace[];
  sharedPlaces?: TPlace[];
  templateMode?: boolean;
  editingTemplate?: GeoPdfTemplate | null;
  onTemplateSaved?: () => void;
  initialTemplateId?: string | null;
  onJobQueued?: (job: GeoPdfJobView) => void;
  /** Open on GeoTIFF with For GIS open, as the Exports page does. */
  openWithGis?: boolean;
  /** The box this opening was given (a selection's, a topo's footprint), which
   *  a GIS format's area starts from. */
  areaSeed?: TBbox | null;
  /** Leave to draw a GIS format's box on the map. */
  onPickArea?: () => void;
  /** The box drawn on the map, handed back. */
  pendingArea?: TBbox | null;
  onExportQueued?: () => void;
}) {
  // ── State ────────────────────────────────────────────────────────────────

  const toast = useToast();
  const formId = useId();

  const [extentState, setExtentState] =
    useState<ExtentState>(DEFAULT_EXTENT_STATE);
  const [templates, setTemplates] = useState<GeoPdfTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    null,
  );
  const [templateName, setTemplateName] = useState("");
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);

  // Layers
  const [selectedBaseLayer, setSelectedBaseLayer] = useState(() =>
    seedBaseLayer(activeLayerId),
  );
  const [selectedOverlays, setSelectedOverlays] =
    useState<Set<string>>(seedOverlays);
  // Until a Terrain layer is ticked or a template applied (`shownOverlays`).
  const [terrainFollowsMap, setTerrainFollowsMap] = useState(true);

  // Map elements
  const [titleEnabled, setTitleEnabled] = useState(false);
  const [titleText, setTitleText] = useState("");
  const [compassEnabled, setCompassEnabled] = useState(true);
  const [scaleTextEnabled, setScaleTextEnabled] = useState(true);
  const [scaleBarEnabled, setScaleBarEnabled] = useState(true);
  const [gridLinesEnabled, setGridLinesEnabled] = useState(false);
  const [gridLinesMode, setGridLinesMode] = useState<CoordMode>("latlon");

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

  // What is made: GeoPDF with For GIS closed, unless `openWithGis` (the render
  // tests "opens on GeoPDF with For GIS closed" and "opens on GeoTIFF").
  const [format, setFormat] = useState<FormatChoice>("geopdf");
  const [gisOpen, setGisOpen] = useState(false);
  // A GIS format's box, once drawn or typed; until then it starts from the
  // opening's box, else the GeoPDF's.
  const [gisBox, setGisBox] = useState<TBbox | null>(null);
  const [gisLayers, setGisLayers] = useState<ReadonlySet<AreaExportLayer>>(
    () => new Set(AREA_EXPORT_LAYERS),
  );
  // Its Exact edges: what is typed, held here so Make it can refuse an edge
  // that shows an error, and whether they are open.
  const gisFocused = useRef<"n" | "s" | "e" | "w" | "scale" | null>(null);
  const [gisRaw, setGisRaw] = useState<ExtentFieldValues>(NO_EDGES_TYPED);
  const [gisEdgesOpen, setGisEdgesOpen] = useState(false);
  // Make it was pressed with something missing: a requirement shows from then
  // on, where a limit shows live (shared/DESIGN.md §11).
  const [gisTried, setGisTried] = useState(false);

  // Generation
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Unsaved-changes tracking. Explicit dirty flag (not snapshot-diffing) —
  // state here is seeded by three programmatic writers at unpredictable
  // times (open-time map-view seed, async launch-template apply, the map
  // round-trip reopen), so a diff-against-baseline approach would false-
  // positive on every seed. Only handlers that represent a direct user
  // interaction with the form set this; programmatic seeds/resets never do.
  const [dirty, setDirty] = useState(false);
  const markDirty = useCallback(() => setDirty(true), []);

  // Template mode name
  const [editTemplateName, setEditTemplateName] = useState("");
  // Under whichever template-name field is showing; only one is at a time.
  const [nameError, setNameError] = useState<string | null>(null);

  // Set when the dialog closes for "Select on map": that close is a round trip,
  // so the close keeps state and the per-session init guards instead of
  // resetting them. Cleared when the dialog reopens.
  const [returningFromMapSelect, setReturningFromMapSelect] = useState(false);

  // Per-session init guards. A template (and the map-view seed) auto-fills the
  // dialog ONCE per genuine open; after that the user is free to edit fields and
  // those edits must survive (e.g. across a "Select on map" round trip) until the
  // dialog is genuinely closed. Reset only in the genuine-close branch below.
  const [seededView, setSeededView] = useState(false);
  const [appliedTemplate, setAppliedTemplate] = useState(false);

  // Raw string state for extent/scale inputs (deferred recalculation)
  const focusedField = useRef<"n" | "s" | "e" | "w" | "scale" | null>(null);
  const [rawN, setRawN] = useState("");
  const [rawS, setRawS] = useState("");
  const [rawE, setRawE] = useState("");
  const [rawW, setRawW] = useState("");
  const [rawScale, setRawScale] = useState("");
  // Other was pressed: its field stays open even at a preset's number.
  const [scaleOtherPicked, setScaleOtherPicked] = useState(false);
  // Exact edges starts closed on every open; Make it opens it when a field
  // inside needs fixing, so the field the banner points at can be seen.
  const [edgesOpen, setEdgesOpen] = useState(false);

  // A template's settings, applied over the form: the launch template (once
  // per genuine open) and the template being edited in template mode.
  function applyTemplateConfig(c: GeoPdfTemplate["config"]) {
    setExtentState((prev: ExtentState) => {
      let updated = {
        ...prev,
        paperSize: c.paperSize,
        orientation: c.orientation,
        ...(c.customRatio ? { customRatio: c.customRatio } : {}),
      };
      updated = applyPaperChange(updated, c.paperSize, c.customRatio);
      if (c.scale !== undefined) updated = applyScaleChange(updated, c.scale);
      return updated;
    });
    setSelectedBaseLayer(c.baseLayer);
    setSelectedOverlays(new Set(c.overlays));
    setTerrainFollowsMap(false);
    if (c.elements.title !== undefined) {
      setTitleEnabled(true);
      setTitleText(c.elements.title);
    } else {
      setTitleEnabled(false);
    }
    setCompassEnabled(c.elements.compass);
    setScaleTextEnabled(c.elements.scaleText);
    setScaleBarEnabled(c.elements.scaleBar);
    if (c.elements.gridLines !== undefined) {
      setGridLinesEnabled(true);
      setGridLinesMode(c.elements.gridLines);
    } else {
      setGridLinesEnabled(false);
    }
  }

  // ── Open and close ───────────────────────────────────────────────────────
  // Three steps that follow props, run during render in this order (the
  // order the effects they replaced ran in): the open/close transition, the
  // template being edited, then a confirmed map pick.

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
        setFormat(openWithGis ? "geotiff" : "geopdf");
        setGisOpen(openWithGis ?? false);
        setSelectedBaseLayer(seedBaseLayer(activeLayerId));
        setSelectedOverlays(seedOverlays());
        setTerrainFollowsMap(true);
        const center = mapCenter;
        if (center) {
          setExtentState((prev) => {
            const paper = getPaperDimensions(prev);
            const mapW = paper.w - 2 * GEOPDF_PADDING_MM;
            const mapH = paper.h - 2 * GEOPDF_PADDING_MM;
            const widthM = prev.scale * (mapW / 1000);
            const heightM = prev.scale * (mapH / 1000);
            const bounds = extentFromCentreAndSize(
              center.lat,
              center.lng,
              widthM,
              heightM,
            );
            return { ...prev, ...bounds };
          });
        }
      }
    } else if (!returningFromMapSelect) {
      setSeededView(false);
      setAppliedTemplate(false);
      setExtentState(DEFAULT_EXTENT_STATE);
      setSelectedTemplateId(null);
      setTemplateName("");
      setShowSaveTemplate(false);
      setTitleEnabled(false);
      setTitleText("");
      setCompassEnabled(true);
      setScaleTextEnabled(true);
      setScaleBarEnabled(true);
      setGridLinesEnabled(false);
      setGridLinesMode("latlon");
      // Place-marker toggles are deliberately NOT reset — they persist via
      // localStorage so the user's explicit choice carries across sessions.
      setError(null);
      setEditTemplateName("");
      setRawN("");
      setRawS("");
      setRawE("");
      setRawW("");
      setRawScale("");
      setScaleOtherPicked(false);
      setEdgesOpen(false);
      setGisBox(null);
      setGisLayers(new Set(AREA_EXPORT_LAYERS));
      setGisRaw(NO_EDGES_TYPED);
      setGisEdgesOpen(false);
      setGisTried(false);
      setDirty(false);
    }
  }

  // Populate fields from editingTemplate when entering template mode. Keyed on
  // the template's id, not the object (a refetch hands over a fresh copy of the
  // same template), and skipped on the reopen after "Select on map", which is a
  // round trip, not a new open: the edits made before the pick must survive it.
  const editingTemplateId = editingTemplate?.id ?? null;
  const [templatePopulatedFor, setTemplatePopulatedFor] = useState({
    open: false,
    templateMode,
    editingTemplateId,
  });
  if (
    open !== templatePopulatedFor.open ||
    templateMode !== templatePopulatedFor.templateMode ||
    editingTemplateId !== templatePopulatedFor.editingTemplateId
  ) {
    setTemplatePopulatedFor({ open, templateMode, editingTemplateId });
    if (open && templateMode && !returningFromMapSelect) {
      if (editingTemplate) {
        setEditTemplateName(editingTemplate.name);
        applyTemplateConfig(editingTemplate.config);
      } else {
        // New template — reset to defaults
        setEditTemplateName("");
      }
    }
  }

  // Populate extent from map selection — always receives both extent and scale.
  // This fires only when the user actually confirms a pick on the map (App
  // only sets these props from onGeoPdfExtentConfirmed), so — unlike the
  // open-time seed and template-apply steps — it represents real user work
  // and must mark the form dirty.
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
      setDirty(true);
    }
  }

  // The box drawn for a GIS format, as the extent above: real user work.
  const [pendingAreaAppliedFor, setPendingAreaAppliedFor] = useState<
    TBbox | null | undefined
  >(null);
  if (pendingArea !== pendingAreaAppliedFor) {
    setPendingAreaAppliedFor(pendingArea);
    if (pendingArea) {
      setGisBox(pendingArea);
      setDirty(true);
    }
  }

  // ── Effects ──────────────────────────────────────────────────────────────

  // Apply the launch template once per genuine open. On the map round-trip
  // reopen appliedTemplate is still set, so the user's edits are not
  // overwritten. An effect event, so the fetch reads the gate as it is when
  // the list arrives without refetching when it flips.
  const applyLaunchTemplate = useEffectEvent((list: GeoPdfTemplate[]) => {
    if (!initialTemplateId || appliedTemplate) return;
    const t = list.find((x) => x.id === initialTemplateId);
    if (!t) return;
    setAppliedTemplate(true);
    setSelectedTemplateId(t.id);
    applyTemplateConfig(t.config);
  });

  // Fetch templates on open (only in normal mode)
  useEffect(() => {
    if (!open || templateMode) return;
    apiFetch<GeoPdfTemplate[]>("/geo-pdf-templates")
      .then((list) => {
        setTemplates(list);
        applyLaunchTemplate(list);
      })
      .catch((err) => {
        console.error(err);
        toast.error(messageFromError(err, "Couldn't load GeoPDF templates."));
      });
  }, [open, templateMode, initialTemplateId, toast]);

  // A template has no area, so every LiDAR layer is offered there.
  const lidarOverlap = useMemo(
    () => templateMode || ownJobInArea(completedTopoJobs, extentState),
    [completedTopoJobs, extentState, templateMode],
  );
  // A template's Terrain layers follow the map, and turn on only if the user
  // has a job of their own anywhere (an area of nothing counts every one).
  const jobInArea = templateMode
    ? ownJobInArea(completedTopoJobs, NO_AREA)
    : lidarOverlap;
  const overlays = useMemo(
    () =>
      shownOverlays(
        selectedOverlays,
        terrainFollowsMap,
        terrainLayers,
        jobInArea,
      ),
    [selectedOverlays, terrainFollowsMap, terrainLayers, jobInArea],
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

  const handleTemplateSelect = useCallback(
    (id: string) => {
      setSelectedTemplateId(id);
      const tmpl = templates.find((t) => t.id === id);
      if (!tmpl) return;
      // Selecting a template is itself a deliberate choice worth guarding,
      // distinct from the launch-template auto-apply effect which must not
      // set this (that one fires once per genuine open, unprompted).
      setDirty(true);
      const c = tmpl.config;
      setExtentState((prev: ExtentState) => {
        let updated = {
          ...prev,
          paperSize: c.paperSize,
          orientation: c.orientation,
          ...(c.customRatio ? { customRatio: c.customRatio } : {}),
        };
        updated = applyPaperChange(updated, c.paperSize, c.customRatio);
        if (c.scale !== undefined) {
          updated = applyScaleChange(updated, c.scale);
        }
        return updated;
      });
      setSelectedBaseLayer(c.baseLayer);
      setSelectedOverlays(new Set(c.overlays));
      setTerrainFollowsMap(false);
      if (c.elements.title !== undefined) {
        setTitleEnabled(true);
        setTitleText(c.elements.title);
      } else {
        setTitleEnabled(false);
      }
      setCompassEnabled(c.elements.compass);
      setScaleTextEnabled(c.elements.scaleText);
      setScaleBarEnabled(c.elements.scaleBar);
      if (c.elements.gridLines !== undefined) {
        setGridLinesEnabled(true);
        setGridLinesMode(c.elements.gridLines);
      } else {
        setGridLinesEnabled(false);
      }
    },
    [templates],
  );

  const buildTemplateConfig = useCallback(
    (): GeoPdfTemplateConfig => ({
      paperSize: extentState.paperSize,
      orientation: extentState.orientation,
      ...(extentState.customRatio
        ? { customRatio: extentState.customRatio }
        : {}),
      scale: extentState.scale,
      baseLayer: selectedBaseLayer,
      overlays: [...overlays].map((id) =>
        id.startsWith("master-") ? id.slice("master-".length) : id,
      ),
      elements: {
        ...(titleEnabled ? { title: titleText } : {}),
        compass: compassEnabled,
        scaleText: scaleTextEnabled,
        scaleBar: scaleBarEnabled,
        ...(gridLinesEnabled ? { gridLines: gridLinesMode } : {}),
      },
    }),
    [
      extentState,
      selectedBaseLayer,
      overlays,
      titleEnabled,
      titleText,
      compassEnabled,
      scaleTextEnabled,
      scaleBarEnabled,
      gridLinesEnabled,
      gridLinesMode,
    ],
  );

  const handleSaveTemplate = useCallback(async () => {
    if (!templateName.trim()) {
      setNameError("Name this template first.");
      return;
    }
    const config = buildTemplateConfig();
    setError(null);
    try {
      await apiFetch("/geo-pdf-templates", {
        method: "POST",
        body: { name: templateName.trim(), config },
      });
      setShowSaveTemplate(false);
      setTemplateName("");
      const updated = await apiFetch<GeoPdfTemplate[]>("/geo-pdf-templates");
      setTemplates(updated);
      toast.success("Template saved.");
    } catch (err) {
      console.error(err);
      setError(
        messageFromError(err, "Couldn't save template. Please try again."),
      );
    }
  }, [templateName, buildTemplateConfig, toast]);

  const handleSaveTemplateMode = useCallback(async () => {
    if (!editTemplateName.trim()) {
      setNameError("Name this template first.");
      return;
    }
    const config = buildTemplateConfig();
    setError(null);
    try {
      if (editingTemplate) {
        await apiFetch(`/geo-pdf-templates/${editingTemplate.id}`, {
          method: "PATCH",
          body: { name: editTemplateName.trim(), config },
        });
      } else {
        await apiFetch("/geo-pdf-templates", {
          method: "POST",
          body: { name: editTemplateName.trim(), config },
        });
      }
      toast.success("Template saved.");
      onTemplateSaved?.();
    } catch (err) {
      console.error(err);
      setError(
        messageFromError(err, "Couldn't save template. Please try again."),
      );
    }
  }, [
    editTemplateName,
    editingTemplate,
    buildTemplateConfig,
    onTemplateSaved,
    toast,
  ]);

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
    !templateMode &&
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
      if (edgeError) setGisEdgesOpen(true);
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
      toast.success(
        "Export queued. It turns up in Maps, Exports, and downloads itself when it's ready.",
      );
      onExportQueued?.();
      onClose();
    } catch (e) {
      console.error(e);
      setError(
        messageFromError(e, "Couldn't queue the export. Please try again."),
      );
    } finally {
      setGenerating(false);
    }
  };

  const handleGenerate = useCallback(async () => {
    if (
      !extentValid ||
      hasExtentFieldError(extentInputErrors) ||
      scaleInputError !== null ||
      tooLarge
    ) {
      if (!extentValid || hasExtentFieldError(extentInputErrors))
        setEdgesOpen(true);
      setError("A field below needs fixing first.");
      return;
    }
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
      overlays: [...overlays].map((id) =>
        id.startsWith("master-") ? id.slice("master-".length) : id,
      ),
      elements: {
        ...(titleEnabled ? { title: titleText } : {}),
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

    try {
      const job = await apiFetch<GeoPdfJobView>("/geo-pdf", {
        method: "POST",
        body: config,
      });
      toast.success(
        "GeoPDF queued — download will appear in the GeoPDFs panel.",
      );
      onJobQueued?.(job);
      onClose();
    } catch (e) {
      console.error(e);
      setError(messageFromError(e, "Couldn't queue GeoPDF. Please try again."));
    } finally {
      setGenerating(false);
    }
  }, [
    extentState,
    selectedBaseLayer,
    overlays,
    titleEnabled,
    titleText,
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
    onJobQueued,
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

  // Esc / backdrop / X / Cancel route through this so a dirty form prompts
  // before discarding. "Select on map" bypasses it entirely (it calls
  // onSelectOnMap, never onClose/requestClose — App flips `open` to false
  // itself for that round trip). A successful Generate/Save-Template also
  // bypasses it by calling the raw onClose/onTemplateSaved directly.
  const guard = useUnsavedChangesGuard(dirty, onClose);

  // ── Render ───────────────────────────────────────────────────────────────

  const mapMm = getMapDimensions(extentState);
  const title = templateMode
    ? editingTemplate
      ? "Edit template"
      : "New template"
    : "Export an area";

  return (
    <>
      <Dialog
        open={open}
        title={title}
        size="large"
        dismissible={!generating}
        onClose={guard.requestClose}
        // Pinned: which template this form came from, and the button that turns
        // the whole form into one, both act on everything below rather than on
        // the section on screen (DESIGN.md). In template mode the NAME is
        // what the dialog is about, so it sits here for the same reason.
        toolbar={
          format !== "geopdf" ? undefined : templateMode ? (
            <form
              id={formId}
              onSubmit={(event) => {
                event.preventDefault();
                void handleSaveTemplateMode();
              }}
            >
              <TextField
                label="Template name"
                value={editTemplateName}
                error={nameError}
                data-autofocus
                onChange={(event) => {
                  setEditTemplateName(event.target.value);
                  setNameError(null);
                  markDirty();
                }}
              />
            </form>
          ) : (
            <div className={classes.templateLine}>
              {showSaveTemplate ? (
                <>
                  <TextField
                    label="Template name"
                    hideLabel
                    className={classes.templateField}
                    placeholder="Name this template"
                    value={templateName}
                    error={nameError}
                    // eslint-disable-next-line no-restricted-syntax -- mounts after the dialog is open, where autoFocus works
                    autoFocus
                    onChange={(event) => {
                      setTemplateName(event.target.value);
                      setNameError(null);
                      markDirty();
                    }}
                  />
                  <Button variant="filled" compact onClick={handleSaveTemplate}>
                    Save
                  </Button>
                  <Button
                    compact
                    onClick={() => {
                      setShowSaveTemplate(false);
                      setTemplateName("");
                      setNameError(null);
                    }}
                  >
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <Select
                    label="Template"
                    hideLabel
                    className={classes.templateField}
                    value={selectedTemplateId ?? ""}
                    onChange={(event) => {
                      if (event.target.value)
                        handleTemplateSelect(event.target.value);
                      else setSelectedTemplateId(null);
                    }}
                  >
                    <option value="">No template</option>
                    {templates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name}
                      </option>
                    ))}
                  </Select>
                  <Button
                    compact
                    variant="outline"
                    onClick={() => setShowSaveTemplate(true)}
                  >
                    Save as a template
                  </Button>
                </>
              )}
            </div>
          )
        }
        footer={
          <>
            <Button
              onClick={guard.requestClose}
              disabled={generating}
              disabledReason={
                gisFormat ? "Starting the export…" : "Making your GeoPDF…"
              }
            >
              Cancel
            </Button>
            {templateMode ? (
              <Button type="submit" form={formId} variant="filled">
                Save
              </Button>
            ) : (
              <Button
                variant="filled"
                busy={generating}
                onClick={gisFormat ? handleExportArea : handleGenerate}
              >
                Make it
              </Button>
            )}
          </>
        }
      >
        <div className={classes.form}>
          <p className={classes.wideHint}>This is easier on a bigger screen.</p>

          {error && <ErrorBanner message={error} />}

          {!templateMode && (
            <section className={classes.group}>
              <SectionHeader title="Format" />
              {/* Named for what it holds, beside For GIS: the choice spans the
                  two groups, so neither claims it all (the render test "names
                  the GeoPDF group"). */}
              <ChipRail
                label="For print"
                className={classes.railCell}
                options={GEOPDF_OPTION}
                value={format}
                onChange={(next) => {
                  setFormat(next);
                  setError(null);
                }}
              />
              <details
                className={classes.edges}
                open={gisOpen}
                onToggle={(event) => setGisOpen(event.currentTarget.open)}
              >
                <summary className={classes.edgesSummary}>For GIS</summary>
                <div className={classes.group}>
                  <ChipRail
                    label="For GIS"
                    className={classes.railCell}
                    options={GIS_OPTIONS}
                    value={format}
                    onChange={(next) => {
                      setFormat(next);
                      setError(null);
                    }}
                  />
                  {gisFormat && (
                    <p className={classes.note}>
                      {GIS_FORMAT_NOTES[gisFormat]}
                    </p>
                  )}
                </div>
              </details>
            </section>
          )}

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
              edgesOpen={gisEdgesOpen}
              onEdgesOpenChange={setGisEdgesOpen}
              onCoordModeChange={(coordMode) =>
                setExtentState(applyCoordModeChange(extentState, coordMode))
              }
              onAreaChange={(area) => {
                setGisBox(area);
                markDirty();
              }}
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
            />
          ) : (
            <>
              {/* Paper, orientation and scale set the area's size; the map sets
              where it is. A template keeps the first three and has no where,
              so the area itself is absent in template mode. */}
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

                {!templateMode && (
                  <>
                    <SettingsRow label="Area">
                      <div className={classes.areaCell}>
                        <span className={classes.areaSize}>
                          {sheetSizeLabel(
                            (extentState.scale * mapMm.w) / 1000,
                            (extentState.scale * mapMm.h) / 1000,
                          )}
                        </span>
                        <Button
                          icon="pickArea"
                          compact
                          variant="outline"
                          onClick={handleSelectOnMap}
                        >
                          Pick on the map
                        </Button>
                      </div>
                    </SettingsRow>
                    <FieldError message={tooLarge ? GEOPDF_TOO_LARGE : null} />

                    <details
                      className={classes.edges}
                      open={edgesOpen}
                      onToggle={(event) =>
                        setEdgesOpen(event.currentTarget.open)
                      }
                    >
                      <summary className={classes.edgesSummary}>
                        Exact edges
                      </summary>
                      <div className={classes.group}>
                        <SettingsRow
                          label="Coordinates"
                          tooltip={COORD_TOOLTIP}
                        >
                          <ChipRail
                            label="Coordinates"
                            className={classes.railCell}
                            options={COORD_OPTIONS}
                            value={extentState.coordMode}
                            onChange={(coordMode) =>
                              setExtentState(
                                applyCoordModeChange(extentState, coordMode),
                              )
                            }
                          />
                        </SettingsRow>
                        <SettingsRow
                          label="Typing an edge"
                          tooltip={LOCK_TOOLTIP}
                        >
                          <ChipRail
                            label="Typing an edge"
                            className={classes.railCell}
                            options={LOCK_OPTIONS}
                            value={extentState.lockMode}
                            onChange={(lockMode) =>
                              setExtentState({ ...extentState, lockMode })
                            }
                          />
                        </SettingsRow>
                        {/* The four edges laid out where they are on the map, with
                        the point they move around in the middle of them. */}
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
                          <div className={classes.extentCenter}>
                            <span className={classes.pivotLabel}>
                              Pivot
                              <InfoTip
                                label="the pivot"
                                content={PIVOT_TOOLTIP}
                              />
                            </span>
                            <div
                              className={classes.pivotGrid}
                              role="radiogroup"
                              aria-label="Pivot"
                            >
                              {PIVOT_POINTS.map((point) => (
                                <button
                                  key={point.value}
                                  type="button"
                                  role="radio"
                                  aria-checked={
                                    extentState.pivot === point.value
                                  }
                                  aria-label={point.label}
                                  className={
                                    extentState.pivot === point.value
                                      ? classes.pivotButtonActive
                                      : classes.pivotButton
                                  }
                                  onClick={() =>
                                    setExtentState(
                                      applyPivotChange(
                                        extentState,
                                        point.value,
                                      ),
                                    )
                                  }
                                />
                              ))}
                            </div>
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
                    </details>
                  </>
                )}
              </section>

              <section className={classes.group}>
                <SectionHeader title="Layers" />
                <SettingsRow label="Base layer">
                  <ChipRail
                    label="Base layer"
                    className={classes.railCell}
                    options={BASE_LAYER_OPTIONS}
                    value={selectedBaseLayer}
                    onChange={(id) => {
                      setSelectedBaseLayer(id);
                      markDirty();
                    }}
                  />
                </SettingsRow>
                <p className={classes.groupLabel}>{MAP_TERRAIN.title}</p>
                <div className={classes.checkList}>
                  {TERRAIN_LAYER_KEYS.map((key) => {
                    const printed =
                      key === "contours" &&
                      contoursPrintedHere(selectedBaseLayer, lidarOverlap);
                    return (
                      <Checkbox
                        key={key}
                        label={MAP_TERRAIN.copy[key]}
                        description={
                          printed ? MAP_TERRAIN.copy.contoursPrinted : undefined
                        }
                        disabled={printed}
                        checked={!printed && overlays.has(key)}
                        onChange={() => toggleOverlay(key)}
                      />
                    );
                  })}
                </div>
                <p className={classes.groupLabel}>Overlays</p>
                <div className={classes.checkList}>
                  {lidarOverlap &&
                    LIDAR_ONLY_OVERLAYS.map((layer) => (
                      <Checkbox
                        key={layer.name}
                        label={layer.label}
                        checked={overlays.has(layer.name)}
                        onChange={() => toggleOverlay(layer.name)}
                      />
                    ))}
                  <Checkbox
                    label="My places"
                    checked={showOwnedPlacesOnPdf}
                    onChange={setShowOwnedPlacesOnPdf}
                  />
                  <Checkbox
                    label="Shared places"
                    description="A friend shared these with you, not with whoever you hand the PDF to."
                    checked={showSharedPlacesOnPdf}
                    onChange={setShowSharedPlacesOnPdf}
                  />
                </div>
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
                        value={titleText}
                        onChange={(event) => {
                          setTitleText(event.target.value);
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
              </section>
            </>
          )}
        </div>
      </Dialog>

      <ConfirmDialog
        open={guard.guardOpen}
        title="Discard unsaved changes?"
        message="Your changes will be lost."
        confirmLabel="Discard"
        confirmColor="error"
        onConfirm={guard.confirmDiscard}
        onClose={guard.cancelDiscard}
      />
    </>
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
 * typed edge by edge, so there is no paper, scale or pivot; its size shows,
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
  edgesOpen,
  onEdgesOpenChange,
  onCoordModeChange,
  onAreaChange,
  onPick,
  layers,
  onToggleLayer,
  noLayers,
}: {
  format: AreaExportFormat;
  area: TBbox | null;
  areaError: string | null;
  edges: TBbox & { coordMode: CoordMode };
  raw: ExtentFieldValues;
  onDraft: (which: ExtentFieldKey, value: string) => void;
  edgeErrors: ExtentFieldErrors;
  focusedFieldRef: React.RefObject<"n" | "s" | "e" | "w" | "scale" | null>;
  edgesOpen: boolean;
  onEdgesOpenChange: (open: boolean) => void;
  onCoordModeChange: (mode: CoordMode) => void;
  onAreaChange: (area: TBbox) => void;
  onPick: () => void;
  layers: ReadonlySet<AreaExportLayer>;
  onToggleLayer: (layer: AreaExportLayer) => void;
  noLayers: boolean;
}) {
  const { coordMode } = edges;
  const size = area ? areaSizeKm(area) : null;

  return (
    <>
      <section className={classes.group}>
        <SectionHeader title="Area" />
        <SettingsRow label="Area">
          <div className={classes.areaCell}>
            <span className={classes.areaSize}>
              {size
                ? sheetSizeLabel(size.widthKm * 1000, size.heightKm * 1000)
                : "None yet"}
            </span>
            <Button icon="pickArea" compact variant="outline" onClick={onPick}>
              Pick on the map
            </Button>
          </div>
        </SettingsRow>
        <FieldError message={areaError} />
        {area && (
          <details
            className={classes.edges}
            open={edgesOpen}
            onToggle={(event) => onEdgesOpenChange(event.currentTarget.open)}
          >
            <summary className={classes.edgesSummary}>Exact edges</summary>
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
                          ...area,
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
          </details>
        )}
      </section>

      <section className={classes.group}>
        <SectionHeader title="Layers" />
        <div className={classes.checkList}>
          {AREA_EXPORT_LAYERS_BY_FORMAT[format].map((layer) => (
            <Checkbox
              key={layer}
              label={LAYER_LABELS[layer]}
              checked={layers.has(layer)}
              onChange={() => onToggleLayer(layer)}
            />
          ))}
        </div>
        <FieldError message={noLayers ? "Pick at least one layer." : null} />
        {/* No number until computeEstimate has an area-export kind. */}
        <p className={classes.note}>
          Its time and credits aren't known until it has run; it's charged for
          the time it takes.
        </p>
        <p className={classes.note}>
          It turns up in Maps, Exports, and downloads itself when it's ready.
          Exports are kept for 7 days.
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
