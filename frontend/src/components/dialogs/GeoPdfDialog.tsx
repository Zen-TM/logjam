// A GeoPDF: a printable map of one area, on one sheet of paper, at one scale.
// The form asks those three things in that order, then what goes on top.
//
// Nothing here is live — the paper is drawn on the map while you pick an area
// (App's frame), and everything else only matters once the worker renders it —
// so the whole dialog is one form with a Make it at the end, unlike the topo
// settings beside it (DESIGN.md §6).
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { SquareDashed } from "lucide-react";
import type { TBbox } from "../map/Map";
import { BASE_LAYERS } from "../map/Map";
import { TOPO_LAYERS } from "../../topoLayerTypes";
import type { CompletedTopoJob } from "../../topoLayerTypes";
import { apiFetch, type TPlace, type GeoPdfJobView } from "../../placeUtils";
import { messageFromError } from "../../errors/messageFromError";
import { ApiError } from "../../errors/ApiError";
import { ErrorBanner } from "../feedback/ErrorBanner";
import { FieldError } from "../feedback/FieldError";
import { useToast } from "../feedback/ToastProvider";
import { useUnsavedChangesGuard } from "../../useUnsavedChangesGuard";
import ConfirmDialog from "./ConfirmDialog";
import { sanitizeDecimalInput } from "../../numberInput";
import {
  extentFieldErrors,
  hasExtentFieldError,
  parseExtentField,
  scaleFieldError,
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
  toEastingNorthing,
  extentFromCentreAndSize,
} from "@logjam/shared";
import type { GeoPdfConfig } from "@logjam/shared";
import { useStoredState } from "../../useStoredState";
import { buildPlaceMarkers } from "./geoPdfPlaceMarkers";
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
// accessible name rather than a caption under it (DESIGN.md §9).
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

const LOCK_OPTIONS: ChipOption<ExtentState["lockMode"]>[] = [
  { value: "scale", label: "Scale" },
  { value: "position", label: "Position" },
];

const COORD_OPTIONS: ChipOption<CoordMode>[] = [
  { value: "latlon", label: "Lat/Lon" },
  { value: "enNorthing", label: "E/N" },
];

// Raster only — the renderer fetches XYZ tiles, which a vector PMTiles archive
// cannot provide.
const BASE_LAYER_OPTIONS: ChipOption<string>[] = BASE_LAYERS.filter(
  (layer) => layer.kind === "raster" && !layer.id.startsWith("osm") && layer.id !== "six-base",
).map((layer) => ({ value: layer.id, label: layer.name }));

const FALLBACK_BASE_LAYER = "six-topo";

/**
 * The base layer to open with, given whatever the map is showing. The map's own
 * layer is kept when this form can honour it, and otherwise the fallback is —
 * asking the LIST rather than testing the id's prefix, which is what makes this
 * hold for a basemap added later.
 */
function seedBaseLayer(activeLayerId: string): string {
  return BASE_LAYER_OPTIONS.some((option) => option.value === activeLayerId)
    ? activeLayerId
    : FALLBACK_BASE_LAYER;
}

const LOCK_TOOLTIP =
  "Scale keeps the map scale constant when you move the box — the box resizes instead of stretching. Position keeps the centre fixed when you change the scale, so the box grows or shrinks around it.";
const COORD_TOOLTIP =
  "Lat/Lon is decimal degrees, the global GPS format (-33.8912, 150.1234). E/N is easting and northing in MGA2020 (GDA2020), what NSW topo maps and grid references use.";
const PIVOT_TOOLTIP =
  "The point that stays put when you resize the extent or change the scale. Top left keeps the north-west corner anchored.";
const SCALE_TOOLTIP =
  "1:25 000 means 1 cm on the paper is 250 m on the ground. Standard topo maps are 1:25 000 or 1:50 000.";

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

function GeoPdfDialog({
  open,
  onClose,
  onSelectOnMap,
  pendingExtent,
  pendingScale,
  activeLayerId,
  completedTopoJobs,
  mapCenter,
  places,
  sharedPlaces,
  templateMode,
  editingTemplate,
  onTemplateSaved,
  initialTemplateId,
  onJobQueued,
}: {
  open: boolean;
  onClose: () => void;
  onSelectOnMap: (
    paperAspectRatio: number,
    paperDimensions: { w: number; h: number },
    initialExtent?: TBbox,
    initialScale?: number,
  ) => void;
  pendingExtent: TBbox | null;
  pendingScale: number | null;
  activeLayerId: string;
  completedTopoJobs: CompletedTopoJob[];
  mapCenter?: { lat: number; lng: number } | null;
  places?: TPlace[];
  sharedPlaces?: TPlace[];
  templateMode?: boolean;
  editingTemplate?: GeoPdfTemplate | null;
  onTemplateSaved?: () => void;
  initialTemplateId?: string | null;
  onJobQueued?: (job: GeoPdfJobView) => void;
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
  const [selectedBaseLayer, setSelectedBaseLayer] = useState(() => seedBaseLayer(activeLayerId));
  const [selectedOverlays, setSelectedOverlays] = useState<Set<string>>(() => {
    return new Set(TOPO_LAYERS.map((l) => l.name));
  });

  // Map elements
  const [titleEnabled, setTitleEnabled] = useState(false);
  const [titleText, setTitleText] = useState("");
  const [compassEnabled, setCompassEnabled] = useState(true);
  const [scaleTextEnabled, setScaleTextEnabled] = useState(true);
  const [scaleBarEnabled, setScaleBarEnabled] = useState(true);
  const [gridLinesEnabled, setGridLinesEnabled] = useState(false);
  const [gridLinesMode, setGridLinesMode] = useState<CoordMode>("latlon");

  // Place overlays. Persisted so a deliberate opt-in survives reopen.
  // Shared places default OFF (PRIV-006): a friend consented to in-app
  // viewing, not to being named on a printable artifact — opt-in only.
  const [showOwnedPlacesOnPdf, setShowOwnedPlacesOnPdf] = useStoredState(
    "logjam.geoPdf.showOwnedPlaces",
    true,
  );
  const [showSharedPlacesOnPdf, setShowSharedPlacesOnPdf] = useStoredState(
    "logjam.geoPdf.showSharedPlaces",
    false,
  );

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

  // Tracks when dialog is reopening after "Select on map" — tells the
  // reset-on-close effect this close is a round trip, so it preserves state
  // and the per-session init guards instead of resetting them.
  const returningFromMapSelect = useRef(false);

  // Per-session init guards. A template (and the map-view seed) auto-fills the
  // dialog ONCE per genuine open; after that the user is free to edit fields and
  // those edits must survive (e.g. across a "Select on map" round trip) until the
  // dialog is genuinely closed. Reset only in the genuine-close branch below.
  const seededViewRef = useRef(false);
  const appliedTemplateRef = useRef(false);

  // Latest props read at open time without making them effect triggers — these
  // change reference on map move / topo-job polling and must not re-run init.
  const mapCenterRef = useRef(mapCenter);
  mapCenterRef.current = mapCenter;
  const activeLayerIdRef = useRef(activeLayerId);
  activeLayerIdRef.current = activeLayerId;

  // Raw string state for extent/scale inputs (deferred recalculation)
  const focusedField = useRef<"n" | "s" | "e" | "w" | "scale" | null>(null);
  const [rawN, setRawN] = useState("");
  const [rawS, setRawS] = useState("");
  const [rawE, setRawE] = useState("");
  const [rawW, setRawW] = useState("");
  const [rawScale, setRawScale] = useState("");

  // ── Effects ──────────────────────────────────────────────────────────────

  // Reset all state on close (but not on the map round-trip close).
  useEffect(() => {
    if (open) return;
    if (returningFromMapSelect.current) return;
    seededViewRef.current = false;
    appliedTemplateRef.current = false;
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
    setRawN(""); setRawS(""); setRawE(""); setRawW(""); setRawScale("");
    setDirty(false);
  }, [open]);

  // Seed layers + extent from the current map view, once per genuine open.
  // The returningFromMapSelect flag is cleared here (the close it described has
  // happened); the seededViewRef gate skips re-seeding on the map round trip and
  // on prop-reference churn, so user edits survive.
  useEffect(() => {
    if (!open) return;
    returningFromMapSelect.current = false;
    if (seededViewRef.current) return;
    seededViewRef.current = true;

    setSelectedBaseLayer(seedBaseLayer(activeLayerIdRef.current));
    setSelectedOverlays(new Set(TOPO_LAYERS.map((l) => l.name)));

    const center = mapCenterRef.current;
    if (!center) return;
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
  }, [open]);

  // Fetch templates on open (only in normal mode)
  useEffect(() => {
    if (!open || templateMode) return;
    apiFetch<GeoPdfTemplate[]>("/geo-pdf-templates")
      .then((list) => {
        setTemplates(list);
        // Apply the launch template once per genuine open. On the map round-trip
        // reopen this ref is still set, so the user's edits are not overwritten.
        if (initialTemplateId && !appliedTemplateRef.current) {
          const t = list.find((x) => x.id === initialTemplateId);
          if (t) {
            appliedTemplateRef.current = true;
            const c = t.config;
            setSelectedTemplateId(t.id);
            setExtentState((prev: ExtentState) => {
              let updated = { ...prev, paperSize: c.paperSize, orientation: c.orientation, ...(c.customRatio ? { customRatio: c.customRatio } : {}) };
              updated = applyPaperChange(updated, c.paperSize, c.customRatio);
              if (c.scale !== undefined) updated = applyScaleChange(updated, c.scale);
              return updated;
            });
            setSelectedBaseLayer(c.baseLayer);
            setSelectedOverlays(new Set(c.overlays));
            if (c.elements.title !== undefined) { setTitleEnabled(true); setTitleText(c.elements.title); } else { setTitleEnabled(false); }
            setCompassEnabled(c.elements.compass);
            setScaleTextEnabled(c.elements.scaleText);
            setScaleBarEnabled(c.elements.scaleBar);
            if (c.elements.gridLines !== undefined) { setGridLinesEnabled(true); setGridLinesMode(c.elements.gridLines); } else { setGridLinesEnabled(false); }
          }
        }
      })
      .catch((err) => {
        console.error(err);
        toast.error(messageFromError(err, "Couldn't load GeoPDF templates."));
      });
  }, [open, templateMode, initialTemplateId, toast]);

  // Populate fields from editingTemplate when entering template mode
  useEffect(() => {
    if (!open || !templateMode) return;
    if (editingTemplate) {
      setEditTemplateName(editingTemplate.name);
      const c = editingTemplate.config;
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
    } else {
      // New template — reset to defaults
      setEditTemplateName("");
    }
  }, [open, templateMode, editingTemplate]);

  // True when any of the user's completed-job footprints overlaps the current
  // export extent. Falls back to true when no footprints are stored or the
  // extent is uninitialised — never wrongly hides.
  const lidarOverlap = useMemo(() => {
    if (templateMode) return true;
    const ext = extentState;
    if (ext.north <= ext.south || ext.east <= ext.west) return true;
    const withFp = completedTopoJobs.filter((j) => j.footprint);
    if (withFp.length === 0) return true;
    return withFp.some((j) => {
      const fp = j.footprint!;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      const visit = (pt: number[]) => {
        if (pt[0] < minX) minX = pt[0];
        if (pt[0] > maxX) maxX = pt[0];
        if (pt[1] < minY) minY = pt[1];
        if (pt[1] > maxY) maxY = pt[1];
      };
      const walkRings = (rings: number[][][]) =>
        rings.forEach((r) => r.forEach(visit));
      if (fp.type === "Polygon") {
        walkRings(fp.coordinates);
      } else {
        fp.coordinates.forEach(walkRings);
      }
      if (!Number.isFinite(minX)) return true;
      return (
        maxX > ext.west &&
        minX < ext.east &&
        maxY > ext.south &&
        minY < ext.north
      );
    });
  }, [completedTopoJobs, extentState, templateMode]);

  // Populate extent from map selection — always receives both extent and scale.
  // This fires only when the user actually confirms a pick on the map (App
  // only sets these props from onGeoPdfExtentConfirmed), so — unlike the
  // open-time seed and template-apply effects — it represents real user work
  // and must mark the form dirty.
  useEffect(() => {
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
  }, [pendingExtent, pendingScale]);

  // Display helpers for coord mode
  const formatCoord = useCallback(
    (lat: number, lon: number, which: "lat" | "lon"): string => {
      if (extentState.coordMode === "latlon") {
        return which === "lat" ? lat.toFixed(6) : lon.toFixed(6);
      }
      const en = toEastingNorthing(lat, lon);
      return which === "lat" ? en.northing.toFixed(1) : en.easting.toFixed(1);
    },
    [extentState.coordMode],
  );

  // Sync raw strings from extentState whenever extentState changes,
  // but only for fields the user is not currently editing.
  useEffect(() => {
    if (focusedField.current !== "n")
      setRawN(formatCoord(extentState.north, extentState.west, "lat"));
    if (focusedField.current !== "s")
      setRawS(formatCoord(extentState.south, extentState.east, "lat"));
    if (focusedField.current !== "e")
      setRawE(formatCoord(extentState.north, extentState.east, "lon"));
    if (focusedField.current !== "w")
      setRawW(formatCoord(extentState.south, extentState.west, "lon"));
    if (focusedField.current !== "scale")
      setRawScale(String(Math.round(extentState.scale)));
  }, [extentState, formatCoord]);

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
    returningFromMapSelect.current = true;
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
    );
  }, [extentState, onSelectOnMap]);

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
      overlays: [...selectedOverlays].map((id) =>
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
      selectedOverlays,
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
    if (!templateName.trim()) return;
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
      setError(messageFromError(err, "Couldn't save template. Please try again."));
    }
  }, [templateName, buildTemplateConfig, toast]);

  const handleSaveTemplateMode = useCallback(async () => {
    if (!editTemplateName.trim()) return;
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
      setError(messageFromError(err, "Couldn't save template. Please try again."));
    }
  }, [editTemplateName, editingTemplate, buildTemplateConfig, onTemplateSaved, toast]);

  const handleGenerate = useCallback(async () => {
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
      overlays: [...selectedOverlays].map((id) =>
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
    // places are opt-in only (PRIV-006) — boundary enforced and tested in
    // buildPlaceMarkers.
    const markers = buildPlaceMarkers(places, sharedPlaces, config.extent, {
      includeOwned: showOwnedPlacesOnPdf,
      includeShared: showSharedPlacesOnPdf,
    });
    if (markers.length > 0) {
      config.placeMarkers = markers;
    }

    try {
      const job = await apiFetch<GeoPdfJobView>("/geo-pdf", { method: "POST", body: config });
      toast.success("GeoPDF queued — download will appear in the GeoPDFs panel.");
      onJobQueued?.(job);
      onClose();
    } catch (e) {
      console.error(e);
      if (e instanceof ApiError && (e.status === 429 || e.status === 503)) {
        setError("You already have GeoPDFs generating. Please wait for one to finish before starting another.");
      } else {
        setError(messageFromError(e, "Couldn't queue GeoPDF. Please try again."));
      }
    } finally {
      setGenerating(false);
    }
  }, [
    extentState,
    selectedBaseLayer,
    selectedOverlays,
    titleEnabled,
    titleText,
    compassEnabled,
    scaleTextEnabled,
    scaleBarEnabled,
    gridLinesEnabled,
    gridLinesMode,
    // The place-marker inputs are dependencies like any other. Left out, a
    // session that only touched these four kept the callback it was built
    // with — so turning Shared places OFF and pressing Generate still drew
    // them, which is the one direction of this bug that matters (PRIV-006).
    places,
    sharedPlaces,
    showOwnedPlacesOnPdf,
    showSharedPlacesOnPdf,
    onJobQueued,
    toast,
    onClose,
  ]);

  const toggleOverlay = useCallback((name: string) => {
    setSelectedOverlays((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
    setDirty(true);
  }, []);

  const extentValid =
    extentState.north > extentState.south &&
    extentState.east > extentState.west &&
    extentState.scale > 0;

  // Inline validation of the raw extent/scale inputs (GEOPDF-1). A field left
  // in an invalid state (non-numeric, out of range, North not above South,
  // East not right of West) shows a FieldError and blocks Generate — the old
  // behaviour silently discarded the input while still displaying it.
  const extentInputErrors = extentFieldErrors(
    { n: rawN, s: rawS, e: rawE, w: rawW },
    extentState,
  );
  const scaleInputError = scaleFieldError(rawScale);

  // Esc / backdrop / X / Cancel route through this so a dirty form prompts
  // before discarding. "Select on map" bypasses it entirely (it calls
  // onSelectOnMap, never onClose/requestClose — App flips `open` to false
  // itself for that round trip). A successful Generate/Save-Template also
  // bypasses it by calling the raw onClose/onTemplateSaved directly.
  const guard = useUnsavedChangesGuard(dirty, onClose);

  // ── Render ───────────────────────────────────────────────────────────────

  const title = templateMode
    ? editingTemplate
      ? "Edit template"
      : "New template"
    : "Make a GeoPDF";

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
        // the section on screen (DESIGN.md §6). In template mode the NAME is
        // what the dialog is about, so it sits here for the same reason.
        toolbar={
          templateMode ? (
            <form
              id={formId}
              onSubmit={(event) => {
                event.preventDefault();
                if (editTemplateName.trim()) void handleSaveTemplateMode();
              }}
            >
              <TextField
                label="Template name"
                value={editTemplateName}
                data-autofocus
                onChange={(event) => {
                  setEditTemplateName(event.target.value);
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
                    autoFocus
                    onChange={(event) => {
                      setTemplateName(event.target.value);
                      markDirty();
                    }}
                  />
                  <Button
                    variant="filled"
                    compact
                    disabled={!templateName.trim()}
                    onClick={handleSaveTemplate}
                  >
                    Save
                  </Button>
                  <Button
                    compact
                    onClick={() => {
                      setShowSaveTemplate(false);
                      setTemplateName("");
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
                      if (event.target.value) handleTemplateSelect(event.target.value);
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
                  <Button compact variant="outline" onClick={() => setShowSaveTemplate(true)}>
                    Save as a template
                  </Button>
                </>
              )}
            </div>
          )
        }
        footer={
          <>
            <Button onClick={guard.requestClose} disabled={generating}>
              Cancel
            </Button>
            {templateMode ? (
              <Button
                type="submit"
                form={formId}
                variant="filled"
                disabled={!editTemplateName.trim()}
              >
                Save
              </Button>
            ) : (
              <Button
                variant="filled"
                busy={generating}
                onClick={handleGenerate}
                disabled={
                  generating ||
                  !extentValid ||
                  hasExtentFieldError(extentInputErrors) ||
                  scaleInputError !== null
                }
              >
                Make it
              </Button>
            )}
          </>
        }
      >
        <div className={classes.form}>
          <p className={classes.wideHint}>This is easier on a bigger screen.</p>

          <p className={classes.safetyWarning} role="note">
            Generated maps use user-generated and third-party data that may be
            inaccurate or outdated. Not a substitute for your own navigation,
            judgement, or rescue planning.
          </p>

          {error && <ErrorBanner message={error} />}

          <section className={classes.group}>
            <SectionHeader title="Paper" />
            <SettingsRow label="Size">
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
            <SettingsRow label="Orientation" disabled={extentState.paperSize === "custom"}>
              <ChipRail
                label="Orientation"
                className={classes.railCell}
                options={ORIENTATION_OPTIONS}
                value={extentState.orientation}
                onChange={(orientation) => {
                  setExtentState(applyOrientationChange(extentState, orientation));
                  markDirty();
                }}
              />
            </SettingsRow>
            {extentState.paperSize === "custom" && (
              <SettingsRow label="Ratio" tooltip="The sheet's width against its height, in any units you like — 210 by 297 is A4.">
                <div className={classes.ratioRow}>
                  <TextField
                    label="Ratio width"
                    hideLabel
                    className={classes.ratioField}
                    type="text"
                    inputMode="decimal"
                    value={String(extentState.customRatio?.w ?? 210)}
                    onChange={(event) => {
                      const w = parseFloat(sanitizeDecimalInput(event.target.value)) || 1;
                      const h = extentState.customRatio?.h ?? 297;
                      setExtentState(applyPaperChange(extentState, "custom", { w, h }));
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
                      const h = parseFloat(sanitizeDecimalInput(event.target.value)) || 1;
                      const w = extentState.customRatio?.w ?? 210;
                      setExtentState(applyPaperChange(extentState, "custom", { w, h }));
                      markDirty();
                    }}
                  />
                </div>
              </SettingsRow>
            )}
          </section>

          <section className={classes.group}>
            <SectionHeader title="Extent" />
            <SettingsRow label="Lock" tooltip={LOCK_TOOLTIP}>
              <ChipRail
                label="Lock"
                className={classes.railCell}
                options={LOCK_OPTIONS}
                value={extentState.lockMode}
                onChange={(lockMode) => setExtentState({ ...extentState, lockMode })}
              />
            </SettingsRow>
            <SettingsRow label="Coordinates" tooltip={COORD_TOOLTIP}>
              <ChipRail
                label="Coordinates"
                className={classes.railCell}
                options={COORD_OPTIONS}
                value={extentState.coordMode}
                onChange={(coordMode) =>
                  setExtentState(applyCoordModeChange(extentState, coordMode))
                }
              />
            </SettingsRow>

            {/* The four edges laid out where they are on the map, with the
                point they move around in the middle of them. In template mode
                there is no area yet — a template is the HOW, not the where —
                so the box is inert. */}
            <div className={classes.extentGrid} data-disabled={templateMode || undefined}>
              <div className={classes.extentNorth}>
                <ExtentField
                  which="n"
                  label={extentState.coordMode === "latlon" ? "North" : "N (northing)"}
                  value={rawN}
                  error={templateMode ? null : extentInputErrors.n}
                  focusedField={focusedField}
                  onDraft={setRawN}
                  onCommit={(deg) => setExtentState((s) => applyNorthChange(s, deg))}
                  parse={(raw) => parseExtentField("n", raw, extentState)}
                  valid={extentInputErrors.n === null}
                  markDirty={markDirty}
                />
              </div>
              <div className={classes.extentWest}>
                <ExtentField
                  which="w"
                  label={extentState.coordMode === "latlon" ? "West" : "W (easting)"}
                  value={rawW}
                  error={templateMode ? null : extentInputErrors.w}
                  focusedField={focusedField}
                  onDraft={setRawW}
                  onCommit={(deg) => setExtentState((s) => applyWestChange(s, deg))}
                  parse={(raw) => parseExtentField("w", raw, extentState)}
                  valid={extentInputErrors.w === null}
                  markDirty={markDirty}
                />
              </div>
              <div className={classes.extentCenter}>
                <span className={classes.pivotLabel}>
                  Pivot
                  <InfoTip label="the pivot" content={PIVOT_TOOLTIP} />
                </span>
                <div className={classes.pivotGrid} role="radiogroup" aria-label="Pivot">
                  {PIVOT_POINTS.map((point) => (
                    <button
                      key={point.value}
                      type="button"
                      role="radio"
                      aria-checked={extentState.pivot === point.value}
                      aria-label={point.label}
                      className={
                        extentState.pivot === point.value
                          ? classes.pivotButtonActive
                          : classes.pivotButton
                      }
                      onClick={() => setExtentState(applyPivotChange(extentState, point.value))}
                    />
                  ))}
                </div>
              </div>
              <div className={classes.extentEast}>
                <ExtentField
                  which="e"
                  label={extentState.coordMode === "latlon" ? "East" : "E (easting)"}
                  value={rawE}
                  error={templateMode ? null : extentInputErrors.e}
                  focusedField={focusedField}
                  onDraft={setRawE}
                  onCommit={(deg) => setExtentState((s) => applyEastChange(s, deg))}
                  parse={(raw) => parseExtentField("e", raw, extentState)}
                  valid={extentInputErrors.e === null}
                  markDirty={markDirty}
                />
              </div>
              <div className={classes.extentSouth}>
                <ExtentField
                  which="s"
                  label={extentState.coordMode === "latlon" ? "South" : "S (northing)"}
                  value={rawS}
                  error={templateMode ? null : extentInputErrors.s}
                  focusedField={focusedField}
                  onDraft={setRawS}
                  onCommit={(deg) => setExtentState((s) => applySouthChange(s, deg))}
                  parse={(raw) => parseExtentField("s", raw, extentState)}
                  valid={extentInputErrors.s === null}
                  markDirty={markDirty}
                />
              </div>
            </div>

            <SettingsRow label="Scale" tooltip={SCALE_TOOLTIP}>
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
                      setExtentState((s: ExtentState) => applyScaleChange(s, value));
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                  }}
                />
              </div>
            </SettingsRow>
            <FieldError message={scaleInputError} />

            {!templateMode && (
              <div className={classes.errandLine}>
                <Button icon={SquareDashed} compact variant="outline" onClick={handleSelectOnMap}>
                  Draw the area on the map
                </Button>
              </div>
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
            <p className={classes.groupLabel}>Over the top</p>
            <div className={classes.checkList}>
              {lidarOverlap &&
                TOPO_LAYERS.map((layer) => (
                  <Checkbox
                    key={layer.name}
                    label={layer.label}
                    checked={selectedOverlays.has(layer.name)}
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
            <SectionHeader title="On the paper" />
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
 * instead of being silently discarded (GEOPDF-1); leaving the field with a good
 * one commits it, and Enter is the same as leaving.
 */
function ExtentField({
  which,
  label,
  value,
  error,
  focusedField,
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
  focusedField: React.RefObject<"n" | "s" | "e" | "w" | "scale" | null>;
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
        focusedField.current = which;
      }}
      onChange={(event) => {
        onDraft(sanitizeDecimalInput(event.target.value));
        markDirty();
      }}
      onBlur={() => {
        focusedField.current = null;
        const degrees = parse(value);
        if (degrees !== null && valid) onCommit(degrees);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}

export default GeoPdfDialog;
