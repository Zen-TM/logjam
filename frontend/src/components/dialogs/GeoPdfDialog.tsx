import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  IconButton,
  CircularProgress,
  Typography,
  Select,
  MenuItem,
  TextField,
  Tooltip,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import type { TBbox } from "../map/Map";
import { BASE_LAYERS } from "../map/Map";
import { TOPO_LAYERS } from "../../topoLayerTypes";
import type { CompletedTopoJob } from "../../topoLayerTypes";
import { apiFetch, apiFetchBlobStreamed, type TCanyon } from "../../canyonUtils";
import { messageFromError } from "../../errors/messageFromError";
import { ErrorBanner } from "../feedback/ErrorBanner";
import { useToast } from "../feedback/ToastProvider";
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
import type { GeoPdfConfig, CanyonMarker } from "@logjam/shared";
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

export type GeoPdfJob = {
  id: string;
  startedAt: number;
  configSummary: string;
  status: "submitting" | "processing";
};

// ── Constants ────────────────────────────────────────────────────────────────

const PAPER_SIZES: PaperSize[] = ["A2", "A3", "A4", "A5", "custom"];
const PIVOT_POINTS: PivotPoint[] = [
  "tl",
  "tc",
  "tr",
  "ml",
  "mc",
  "mr",
  "bl",
  "bc",
  "br",
];

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

function getContourInterval(scale: number): number {
  if (scale <= 10000) return 5;
  if (scale <= 25000) return 10;
  return 50;
}

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
  canyons,
  sharedCanyons,
  templateMode,
  editingTemplate,
  onTemplateSaved,
  initialTemplateId,
  addGeoPdfJob,
  markGeoPdfJobProcessing,
  removeGeoPdfJob,
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
  canyons?: TCanyon[];
  sharedCanyons?: TCanyon[];
  templateMode?: boolean;
  editingTemplate?: GeoPdfTemplate | null;
  onTemplateSaved?: () => void;
  initialTemplateId?: string | null;
  addGeoPdfJob?: (job: GeoPdfJob) => void;
  markGeoPdfJobProcessing?: (id: string) => void;
  removeGeoPdfJob?: (id: string) => void;
}) {
  // ── State ────────────────────────────────────────────────────────────────

  const toast = useToast();

  const [extentState, setExtentState] =
    useState<ExtentState>(DEFAULT_EXTENT_STATE);
  const [templates, setTemplates] = useState<GeoPdfTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    null,
  );
  const [templateName, setTemplateName] = useState("");
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);

  // Layers
  const [selectedBaseLayer, setSelectedBaseLayer] = useState(
    activeLayerId.startsWith("osm") ? "six-topo" : activeLayerId,
  );
  const [selectedOverlays, setSelectedOverlays] = useState<Set<string>>(() => {
    return new Set(TOPO_LAYERS.map((l) => l.name));
  });

  // Map elements
  const [titleEnabled, setTitleEnabled] = useState(false);
  const [titleText, setTitleText] = useState("");
  const [compassEnabled, setCompassEnabled] = useState(true);
  const [contourEnabled, setContourEnabled] = useState(false);
  const [scaleTextEnabled, setScaleTextEnabled] = useState(true);
  const [scaleBarEnabled, setScaleBarEnabled] = useState(true);
  const [gridLinesEnabled, setGridLinesEnabled] = useState(false);
  const [gridLinesMode, setGridLinesMode] = useState<CoordMode>("latlon");

  // Canyon overlays
  const [showOwnedCanyonsOnPdf, setShowOwnedCanyonsOnPdf] = useState(true);
  const [showSharedCanyonsOnPdf, setShowSharedCanyonsOnPdf] = useState(true);

  // Generation
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Template mode name
  const [editTemplateName, setEditTemplateName] = useState("");

  // Tracks when dialog is reopening after "Select on map" — skip layer reset in that case
  const returningFromMapSelect = useRef(false);

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
    setExtentState(DEFAULT_EXTENT_STATE);
    setSelectedTemplateId(null);
    setTemplateName("");
    setShowSaveTemplate(false);
    setTitleEnabled(false);
    setTitleText("");
    setCompassEnabled(true);
    setContourEnabled(false);
    setScaleTextEnabled(true);
    setScaleBarEnabled(true);
    setGridLinesEnabled(false);
    setGridLinesMode("latlon");
    setShowOwnedCanyonsOnPdf(true);
    setShowSharedCanyonsOnPdf(true);
    setError(null);
    setEditTemplateName("");
    setRawN(""); setRawS(""); setRawE(""); setRawW(""); setRawScale("");
  }, [open]);

  // Sync layers + seed extent from current map view on open.
  useEffect(() => {
    if (!open) return;

    if (!returningFromMapSelect.current) {
      setSelectedBaseLayer(
        activeLayerId.startsWith("osm") ? "six-topo" : activeLayerId,
      );
      setSelectedOverlays(new Set(TOPO_LAYERS.map((l) => l.name)));
    }
    returningFromMapSelect.current = false;

    setExtentState((prev) => {
      if (!mapCenter) return prev;
      const paper = getPaperDimensions(prev);
      const mapW = paper.w - 2 * GEOPDF_PADDING_MM;
      const mapH = paper.h - 2 * GEOPDF_PADDING_MM;
      const widthM = prev.scale * (mapW / 1000);
      const heightM = prev.scale * (mapH / 1000);
      const bounds = extentFromCentreAndSize(
        mapCenter.lat,
        mapCenter.lng,
        widthM,
        heightM,
      );
      return { ...prev, ...bounds };
    });
  }, [open, activeLayerId, completedTopoJobs, mapCenter]);

  // Fetch templates on open (only in normal mode)
  useEffect(() => {
    if (!open || templateMode) return;
    apiFetch<GeoPdfTemplate[]>("/geo-pdf-templates")
      .then((list) => {
        setTemplates(list);
        if (initialTemplateId) {
          const t = list.find((x) => x.id === initialTemplateId);
          if (t) {
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
            setContourEnabled(c.elements.contourInterval !== undefined);
            setScaleTextEnabled(c.elements.scaleText);
            setScaleBarEnabled(c.elements.scaleBar);
            if (c.elements.gridLines !== undefined) { setGridLinesEnabled(true); setGridLinesMode(c.elements.gridLines); } else { setGridLinesEnabled(false); }
          }
        }
      })
      .catch((err) => { console.error(err); });
  }, [open, templateMode, initialTemplateId]);

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
      setContourEnabled(c.elements.contourInterval !== undefined);
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

  // Clear contour interval text when contours overlay is deselected
  useEffect(() => {
    const hasContours =
      selectedOverlays.has("contours");
    if (!hasContours) setContourEnabled(false);
  }, [selectedOverlays]);

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
        walkRings(fp.coordinates as number[][][]);
      } else if (fp.type === "MultiPolygon") {
        (fp.coordinates as number[][][][]).forEach(walkRings);
      } else {
        return true; // unknown geometry — defensively include
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

  // Clear contour element when LiDAR coverage leaves the extent
  useEffect(() => {
    if (!lidarOverlap) setContourEnabled(false);
  }, [lidarOverlap]);

  // Populate extent from map selection — always receives both extent and scale
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
      setContourEnabled(c.elements.contourInterval !== undefined);
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
        ...(contourEnabled
          ? { contourInterval: getContourInterval(extentState.scale) }
          : {}),
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
      contourEnabled,
      scaleTextEnabled,
      scaleBarEnabled,
      gridLinesEnabled,
      gridLinesMode,
    ],
  );

  const handleSaveTemplate = useCallback(async () => {
    if (!templateName.trim()) return;
    const config = buildTemplateConfig();
    try {
      await apiFetch("/geo-pdf-templates", {
        method: "POST",
        body: { name: templateName.trim(), config },
      });
      setShowSaveTemplate(false);
      setTemplateName("");
      const updated = await apiFetch<GeoPdfTemplate[]>("/geo-pdf-templates");
      setTemplates(updated);
    } catch {
      // ignore
    }
  }, [templateName, buildTemplateConfig]);

  const handleSaveTemplateMode = useCallback(async () => {
    if (!editTemplateName.trim()) return;
    const config = buildTemplateConfig();
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
      onTemplateSaved?.();
    } catch {
      // ignore
    }
  }, [editTemplateName, editingTemplate, buildTemplateConfig, onTemplateSaved]);

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
        ...(contourEnabled
          ? { contourInterval: getContourInterval(extentState.scale) }
          : {}),
        scaleText: scaleTextEnabled,
        scaleBar: scaleBarEnabled,
        ...(gridLinesEnabled ? { gridLines: gridLinesMode } : {}),
      },
    };

    // Build canyon markers from canyons within the current extent
    const markers: CanyonMarker[] = [];
    const ext = config.extent;
    if (showOwnedCanyonsOnPdf && canyons) {
      for (const c of canyons) {
        if (c.latitude >= ext.south && c.latitude <= ext.north &&
            c.longitude >= ext.west && c.longitude <= ext.east) {
          markers.push({ lat: c.latitude, lon: c.longitude, name: c.name, color: "owned" });
        }
      }
    }
    if (showSharedCanyonsOnPdf && sharedCanyons) {
      for (const c of sharedCanyons) {
        if (c.latitude >= ext.south && c.latitude <= ext.north &&
            c.longitude >= ext.west && c.longitude <= ext.east) {
          markers.push({ lat: c.latitude, lon: c.longitude, name: c.name, color: "shared" });
        }
      }
    }
    if (markers.length > 0) {
      config.canyonMarkers = markers;
    }

    const jobId = crypto.randomUUID();
    addGeoPdfJob?.({
      id: jobId,
      startedAt: Date.now(),
      configSummary: `${config.paperSize} · ${config.baseLayer}`,
      status: "submitting",
    });

    try {
      const blob = await apiFetchBlobStreamed(
        "/geo-pdf",
        { method: "POST", body: config },
        () => {
          markGeoPdfJobProcessing?.(jobId);
          toast.success("GeoPDF submitted — keep this tab open while processing.");
          onClose();
        },
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "logjam-export.pdf";
      a.click();
      URL.revokeObjectURL(url);
      removeGeoPdfJob?.(jobId);
    } catch (e) {
      console.error(e);
      removeGeoPdfJob?.(jobId);
      setError(messageFromError(e, "Couldn't generate PDF. Please try again."));
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
    contourEnabled,
    scaleTextEnabled,
    scaleBarEnabled,
    gridLinesEnabled,
    gridLinesMode,
    addGeoPdfJob,
    markGeoPdfJobProcessing,
    removeGeoPdfJob,
    toast,
    onClose,
  ]);

  const toggleOverlay = useCallback((name: string) => {
    setSelectedOverlays((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      if (name === "contours" && !next.has("contours")) {
        setContourEnabled(false);
      }
      return next;
    });
  }, []);

  const extentValid =
    extentState.north > extentState.south &&
    extentState.east > extentState.west &&
    extentState.scale > 0;

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <Dialog
      open={open}
      onClose={generating ? undefined : onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          backgroundColor: "var(--theme-primary)",
          color: "var(--theme-text-primary)",
          maxHeight: "85vh",
        },
      }}
    >
      <DialogTitle
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          pb: 1,
        }}
      >
        {templateMode
          ? editingTemplate
            ? `Edit Template: ${editingTemplate.name}`
            : "New Template"
          : "Export GeoPDF"}
        <IconButton
          size="small"
          onClick={onClose}
          disabled={generating}
          sx={{ color: "var(--theme-text-primary)" }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers sx={{ borderColor: "rgba(255,255,255,0.1)" }}>
        {/* ── Template name (template mode) ────────────────────── */}
        {templateMode && (
          <div className={classes.section}>
            <div className={classes.sectionLabel}>Template name</div>
            <TextField
              placeholder="Template name"
              value={editTemplateName}
              onChange={(e) => setEditTemplateName(e.target.value)}
              size="small"
              color="secondary"
              sx={{
                width: "100%",
                background: "transparent",
                "& .MuiOutlinedInput-notchedOutline": {
                  border: "1px solid var(--theme-accent)",
                },
                "&:hover .MuiOutlinedInput-notchedOutline": {
                  border: "1px solid var(--theme-accent)",
                },
                "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
                  border: "1px solid var(--theme-accent)",
                },
                "& .MuiOutlinedInput-input": {
                  padding: "0.25rem 0.5rem !important",
                },
              }}
            />
          </div>
        )}

        {/* ── Template loader (normal mode) ────────────────────── */}
        {!templateMode && (
          <div className={classes.section}>
            <div className={classes.sectionLabel}>Template</div>
            <div className={classes.templateRow}>
              <Select
                value={selectedTemplateId ?? ""}
                onChange={(e) => {
                  if (e.target.value) handleTemplateSelect(e.target.value);
                  else setSelectedTemplateId(null);
                }}
                size="small"
                sx={{
                  flex: 1,
                  background: "transparent",
                  border: "1px solid var(--theme-accent)",
                  borderRadius: "var(--radius-sm)",
                  "& .MuiOutlinedInput-notchedOutline": {
                    border: "none",
                  },
                  "&:hover .MuiOutlinedInput-notchedOutline": {
                    border: "none",
                  },
                  "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
                    border: "none",
                  },
                  "& .MuiOutlinedInput-input": {
                    padding: "0.25rem 0.5rem !important",
                  },
                }}
                MenuProps={{
                  PaperProps: {
                    sx: {
                      backgroundColor: "var(--theme-primary)",
                      boxShadow: "0 8px 16px rgba(0, 0, 0, 0.3)",
                    },
                  },
                }}
              >
                <MenuItem value="">— None —</MenuItem>
                {templates.map((t) => (
                  <MenuItem key={t.id} value={t.id}>
                    {t.name}
                  </MenuItem>
                ))}
              </Select>
              <button
                className={classes.smallButtonActive}
                onClick={() => setShowSaveTemplate(!showSaveTemplate)}
                style={{ fontSize: "0.9em", alignSelf: "stretch" }}
              >
                {showSaveTemplate ? "Cancel" : "Save as template"}
              </button>
            </div>
            {showSaveTemplate && (
              <div className={classes.templateSaveRow}>
                <TextField
                  placeholder="Template name"
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  size="small"
                  color="secondary"
                  sx={{
                    flex: 1,
                    background: "transparent",
                    border: "1px solid var(--theme-accent)",
                    borderRadius: "var(--radius-sm)",
                    "& .MuiOutlinedInput-notchedOutline": {
                      border: "none",
                    },
                    "&:hover .MuiOutlinedInput-notchedOutline": {
                      border: "none",
                    },
                    "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
                      border: "none",
                    },
                    "& .MuiOutlinedInput-input": {
                      padding: "0.25rem 0.5rem !important",
                    },
                  }}
                />
                <button
                  className={classes.smallButtonActive}
                  onClick={handleSaveTemplate}
                  style={{ fontSize: "0.9em", alignSelf: "stretch" }}
                >
                  Save
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Paper ────────────────────────────────────────────── */}
        <div className={classes.section}>
          <div className={classes.sectionLabel}>Paper</div>
          <div className={classes.paperRow}>
            {PAPER_SIZES.map((size) => (
              <button
                key={size}
                className={
                  extentState.paperSize === size
                    ? classes.smallButtonActive
                    : classes.smallButton
                }
                onClick={() =>
                  setExtentState(applyPaperChange(extentState, size))
                }
              >
                {size}
              </button>
            ))}
          </div>
          <div
            className={classes.orientationRow}
            style={
              extentState.paperSize === "custom"
                ? { opacity: 0.4, pointerEvents: "none" }
                : undefined
            }
          >
            {(["portrait", "landscape"] as Orientation[]).map((o) => (
              <button
                key={o}
                className={
                  extentState.orientation === o
                    ? classes.smallButtonActive
                    : classes.smallButton
                }
                onClick={() =>
                  setExtentState(applyOrientationChange(extentState, o))
                }
              >
                {o.charAt(0).toUpperCase() + o.slice(1)}
              </button>
            ))}
          </div>
          {extentState.paperSize === "custom" && (
            <div className={classes.customRatioRow}>
              <input
                type="number"
                className={classes.ratioInput}
                value={extentState.customRatio?.w ?? 210}
                onChange={(e) => {
                  const w = parseFloat(e.target.value) || 1;
                  const h = extentState.customRatio?.h ?? 297;
                  setExtentState(
                    applyPaperChange(extentState, "custom", { w, h }),
                  );
                }}
              />
              <span>:</span>
              <input
                type="number"
                className={classes.ratioInput}
                value={extentState.customRatio?.h ?? 297}
                onChange={(e) => {
                  const h = parseFloat(e.target.value) || 1;
                  const w = extentState.customRatio?.w ?? 210;
                  setExtentState(
                    applyPaperChange(extentState, "custom", { w, h }),
                  );
                }}
              />
            </div>
          )}
        </div>

        {/* ── Extent ───────────────────────────────────────────── */}
        <div className={classes.section}>
          <div className={classes.sectionLabel}>Extent</div>

          {/* Lock mode + Coord mode toggles */}
          <div className={classes.toggleRow}>
            <Tooltip title="Keeps the map scale constant when you move the extent box — the box resizes instead of stretching." placement="top" arrow>
              <button
                className={
                  extentState.lockMode === "scale"
                    ? classes.smallButtonActive
                    : classes.smallButton
                }
                onClick={() =>
                  setExtentState({ ...extentState, lockMode: "scale" })
                }
              >
                Lock Scale
              </button>
            </Tooltip>
            <Tooltip title="Keeps the map centre fixed when you change the scale — the box expands or contracts around the centre." placement="top" arrow>
              <button
                className={
                  extentState.lockMode === "position"
                    ? classes.smallButtonActive
                    : classes.smallButton
                }
                onClick={() =>
                  setExtentState({ ...extentState, lockMode: "position" })
                }
              >
                Lock Position
              </button>
            </Tooltip>
          </div>
          <div className={classes.toggleRow}>
            <Tooltip title="Decimal degrees — global standard GPS format (e.g. -33.8912, 150.1234)." placement="top" arrow>
              <button
                className={
                  extentState.coordMode === "latlon"
                    ? classes.smallButtonActive
                    : classes.smallButton
                }
                onClick={() =>
                  setExtentState(applyCoordModeChange(extentState, "latlon"))
                }
              >
                Lat/Lon
              </button>
            </Tooltip>
            <Tooltip title="Easting/Northing in MGA2020 (GDA2020) — the standard for NSW topo maps and field navigation with a grid reference." placement="top" arrow>
              <button
                className={
                  extentState.coordMode === "enNorthing"
                    ? classes.smallButtonActive
                    : classes.smallButton
                }
                onClick={() =>
                  setExtentState(applyCoordModeChange(extentState, "enNorthing"))
                }
              >
                E/N
              </button>
            </Tooltip>
          </div>

          {/* NSEW inputs + pivot */}
          <div
            className={classes.extentGrid}
            style={
              templateMode ? { opacity: 0.4, pointerEvents: "none" } : undefined
            }
          >
            <div className={classes.extentNorth}>
              <div className={classes.extentLabel}>
                {extentState.coordMode === "latlon" ? "North" : "N (northing)"}
              </div>
              <input
                type="number"
                className={classes.extentInput}
                value={rawN}
                onFocus={() => {
                  focusedField.current = "n";
                }}
                onChange={(e) => setRawN(e.target.value)}
                onBlur={() => {
                  focusedField.current = null;
                  const v = parseFloat(rawN);
                  if (!isNaN(v))
                    setExtentState((s: ExtentState) => applyNorthChange(s, v));
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
              />
            </div>
            <div className={classes.extentWest}>
              <div className={classes.extentLabel}>
                {extentState.coordMode === "latlon" ? "West" : "W (easting)"}
              </div>
              <input
                type="number"
                className={classes.extentInput}
                value={rawW}
                onFocus={() => {
                  focusedField.current = "w";
                }}
                onChange={(e) => setRawW(e.target.value)}
                onBlur={() => {
                  focusedField.current = null;
                  const v = parseFloat(rawW);
                  if (!isNaN(v))
                    setExtentState((s: ExtentState) => applyWestChange(s, v));
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
              />
            </div>
            <div className={classes.extentCenter}>
              {/* Pivot picker */}
              <Tooltip title="The point that stays fixed when you resize the extent or change the scale. E.g. top-left keeps the NW corner anchored." placement="top" arrow>
                <div className={classes.pivotGrid}>
                  {PIVOT_POINTS.map((p) => (
                    <button
                      key={p}
                      className={
                        extentState.pivot === p
                          ? classes.pivotButtonActive
                          : classes.pivotButton
                      }
                      onClick={() =>
                        setExtentState(applyPivotChange(extentState, p))
                      }
                      title={p}
                    />
                  ))}
                </div>
              </Tooltip>
            </div>
            <div className={classes.extentEast}>
              <div className={classes.extentLabel}>
                {extentState.coordMode === "latlon" ? "East" : "E (easting)"}
              </div>
              <input
                type="number"
                className={classes.extentInput}
                value={rawE}
                onFocus={() => {
                  focusedField.current = "e";
                }}
                onChange={(e) => setRawE(e.target.value)}
                onBlur={() => {
                  focusedField.current = null;
                  const v = parseFloat(rawE);
                  if (!isNaN(v))
                    setExtentState((s: ExtentState) => applyEastChange(s, v));
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
              />
            </div>
            <div className={classes.extentSouth}>
              <div className={classes.extentLabel}>
                {extentState.coordMode === "latlon" ? "South" : "S (northing)"}
              </div>
              <input
                type="number"
                className={classes.extentInput}
                value={rawS}
                onFocus={() => {
                  focusedField.current = "s";
                }}
                onChange={(e) => setRawS(e.target.value)}
                onBlur={() => {
                  focusedField.current = null;
                  const v = parseFloat(rawS);
                  if (!isNaN(v))
                    setExtentState((s: ExtentState) => applySouthChange(s, v));
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
              />
            </div>
          </div>

          {/* Scale */}
          <Tooltip title="Map scale ratio. 25000 means 1 cm on the PDF = 250 m on the ground. Standard topo maps: 1:25 000 or 1:50 000." placement="top" arrow>
            <div className={classes.scaleRow}>
              <span className={classes.scalePrefix}>1 :</span>
              <input
                type="number"
                className={classes.scaleInput}
                value={rawScale}
                onFocus={() => {
                  focusedField.current = "scale";
                }}
                onChange={(e) => setRawScale(e.target.value)}
                onBlur={() => {
                  focusedField.current = null;
                  const v = parseFloat(rawScale);
                  if (!isNaN(v) && v > 0)
                    setExtentState((s: ExtentState) => applyScaleChange(s, v));
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
              />
            </div>
          </Tooltip>

          {/* Select on map (hidden in template mode) */}
          {!templateMode && (
            <button
              className={classes.selectOnMapButton}
              onClick={handleSelectOnMap}
            >
              Select on map
            </button>
          )}
        </div>

        {/* ── Layers ───────────────────────────────────────────── */}
        <div className={classes.section}>
          <div className={classes.sectionLabel}>Layers</div>
          <div className={classes.layerColumns}>
            <div className={classes.layerColumn}>
              <div className={classes.layerColumnLabel}>Base layer</div>
              {BASE_LAYERS.filter((l) => !l.id.startsWith("osm") && l.id !== "six-base").map((layer) => (
                <label key={layer.id} className={classes.layerOption}>
                  <input
                    type="radio"
                    name="geopdf-base-layer"
                    checked={selectedBaseLayer === layer.id}
                    onChange={() => setSelectedBaseLayer(layer.id)}
                    style={{
                      accentColor: "var(--theme-accent)",
                    }}
                  />
                  {layer.name}
                </label>
              ))}
            </div>
            <div className={classes.layerColumn}>
              <div className={classes.layerColumnLabel}>Overlays</div>
              {lidarOverlap &&
                TOPO_LAYERS.map((layer) => (
                  <label key={layer.name} className={classes.layerOption}>
                    <input
                      type="checkbox"
                      checked={selectedOverlays.has(layer.name)}
                      onChange={() => toggleOverlay(layer.name)}
                      style={{
                        accentColor: "var(--theme-accent)",
                      }}
                    />
                    {layer.label}
                  </label>
                ))}
              <label className={classes.layerOption}>
                <input
                  type="checkbox"
                  checked={showOwnedCanyonsOnPdf}
                  onChange={(e) => setShowOwnedCanyonsOnPdf(e.target.checked)}
                  style={{ accentColor: "var(--theme-accent)" }}
                />
                My Canyons
              </label>
              <label className={classes.layerOption}>
                <input
                  type="checkbox"
                  checked={showSharedCanyonsOnPdf}
                  onChange={(e) => setShowSharedCanyonsOnPdf(e.target.checked)}
                  style={{ accentColor: "var(--theme-accent)" }}
                />
                Shared Canyons
              </label>
            </div>
          </div>
        </div>

        {/* ── Map elements ─────────────────────────────────────── */}
        <div className={classes.section}>
          <div className={classes.sectionLabel}>Map elements</div>

          <div className={classes.elementRow}>
            <input
              type="checkbox"
              checked={titleEnabled}
              onChange={(e) => setTitleEnabled(e.target.checked)}
              style={{
                accentColor: "var(--theme-accent)",
              }}
            />
            <span>Title</span>
            {titleEnabled && (
              <input
                className={classes.elementInput}
                placeholder="Map title"
                value={titleText}
                onChange={(e) => setTitleText(e.target.value)}
              />
            )}
          </div>

          <div className={classes.elementRow}>
            <input
              type="checkbox"
              checked={compassEnabled}
              onChange={(e) => setCompassEnabled(e.target.checked)}
              style={{
                accentColor: "var(--theme-accent)",
              }}
            />
            <span>North arrow (TN / GN / MN)</span>
          </div>

          {lidarOverlap && (
            <div className={classes.elementRow}>
              <input
                type="checkbox"
                checked={contourEnabled}
                onChange={(e) => setContourEnabled(e.target.checked)}
                disabled={!selectedOverlays.has("contours")}
                style={{
                  accentColor: "var(--theme-accent)",
                }}
              />
              <span
                style={
                  !selectedOverlays.has("contours")
                    ? { opacity: 0.5 }
                    : undefined
                }
              >
                Contour interval text
              </span>
              {contourEnabled && extentState.scale > 0 && (
                <span className={classes.elementSuffix}>
                  {getContourInterval(extentState.scale)}m
                </span>
              )}
            </div>
          )}

          <div className={classes.elementRow}>
            <input
              type="checkbox"
              checked={scaleTextEnabled}
              onChange={(e) => setScaleTextEnabled(e.target.checked)}
              style={{
                accentColor: "var(--theme-accent)",
              }}
            />
            <span>Scale text</span>
            {scaleTextEnabled && (
              <span className={classes.elementSuffix}>
                1:{Math.round(extentState.scale).toLocaleString()}
              </span>
            )}
          </div>

          <div className={classes.elementRow}>
            <input
              type="checkbox"
              checked={scaleBarEnabled}
              onChange={(e) => setScaleBarEnabled(e.target.checked)}
              style={{
                accentColor: "var(--theme-accent)",
              }}
            />
            <span>Scale bar</span>
          </div>

          <div className={classes.elementRow}>
            <input
              type="checkbox"
              checked={gridLinesEnabled}
              onChange={(e) => setGridLinesEnabled(e.target.checked)}
              style={{
                accentColor: "var(--theme-accent)",
              }}
            />
            <span>Grid lines</span>
            {gridLinesEnabled && (
              <>
                {(
                  [
                    ["latlon", "Lat/Lon"],
                    ["enNorthing", "E/N"],
                  ] as [CoordMode, string][]
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    className={
                      gridLinesMode === mode
                        ? classes.smallButtonActive
                        : classes.smallButton
                    }
                    onClick={() => setGridLinesMode(mode)}
                    style={{ padding: "0.15em 0.5em", fontSize: "0.8em" }}
                  >
                    {label}
                  </button>
                ))}
              </>
            )}
          </div>
        </div>

        {error && <ErrorBanner message={error} />}
      </DialogContent>

      <DialogActions>
        <Button
          onClick={onClose}
          disabled={generating}
          sx={{ color: "var(--theme-text-primary)" }}
        >
          Cancel
        </Button>
        {templateMode ? (
          <Button
            variant="contained"
            onClick={handleSaveTemplateMode}
            disabled={!editTemplateName.trim()}
            color="secondary"
          >
            Save Template
          </Button>
        ) : (
          <Button
            variant="contained"
            onClick={handleGenerate}
            disabled={generating || !extentValid}
            color="secondary"
          >
            {generating ? (
              <>
                <CircularProgress size={16} sx={{ mr: 1, color: "white" }} />
                Generating…
              </>
            ) : (
              "Generate GeoPDF"
            )}
          </Button>
        )}
      </DialogActions>
      {generating && !templateMode && (
        <Typography variant="caption" sx={{ px: 3, pb: 1, opacity: 0.7 }}>
          This may take up to a minute for large areas.
        </Typography>
      )}
    </Dialog>
  );
}

export default GeoPdfDialog;
