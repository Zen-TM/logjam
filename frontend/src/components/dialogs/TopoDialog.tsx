import { useState, useRef, Fragment, useEffect, useCallback } from "react";
import { useIsMobile } from "../../useIsMobile";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  CircularProgress,
  LinearProgress,
  Chip,
  IconButton,
  Tooltip,
  Collapse,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Select,
  MenuItem,
  TextField,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import {
  apiFetch,
  fetchComputeEstimate,
  fetchCurrentUser,
  putToPresignedUrl,
} from "../../canyonUtils";
import { messageFromError } from "../../errors/messageFromError";
import { ErrorBanner } from "../feedback/ErrorBanner";
import { useUnsavedChangesGuard } from "../../useUnsavedChangesGuard";
import ConfirmDialog from "./ConfirmDialog";
import type { TBbox } from "../map/Map";
import {
  parseZipCentralDirectory,
  classifyElvisEntries,
  ElvisZipError,
  RASTER_TEMPLATE_DEFAULTS,
  AUTO_EXPORT_DEFAULTS,
  cloneRasterTemplateSettings,
  slopeBandsError,
  hillshadeSettingsError,
  estimateElvisTileCount,
  formatCredits,
  regionNameFromSurvey,
  type ElvisStats,
  type RasterTemplateSettings,
  type AutoExportSettings,
} from "@logjam/shared";
import AdvancedSettings from "./topoSettings/AdvancedSettings";
import { nextTopoName } from "./jobName";
import { fetchTopoTemplates } from "./topoTemplatesFetch";
import { formatAreaKm2 } from "./formatArea";
import { fieldSx } from "../../csvImport/dialogStyles";

export type TopoTemplate = {
  id: string;
  name: string;
  isSystem: boolean;
  config: RasterTemplateSettings;
  autoExport: AutoExportSettings | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type Phase = "form" | "uploading" | "finalizing" | "done";

const DEFAULT_TEMPLATE_ID = "default";

// Deep-copy a template's auto-export slice (or fall back to defaults for older
// templates saved before the feature existed) so edits don't mutate the cached
// template list.
function cloneAutoExport(value: AutoExportSettings | null): AutoExportSettings {
  if (!value) return { ...AUTO_EXPORT_DEFAULTS };
  return { ...value, layers: [...value.layers] };
}

// ── Types ────────────────────────────────────────────────────────────────────

export type TopoJobStatus =
  | "uploading"
  | "pending"
  | "processing"
  | "complete"
  | "failed";

// Footprint geometry types are canonical in topoLayerTypes; re-exported here so
// existing `from "../dialogs/TopoDialog"` imports keep working.
export type { GeoJsonPolygonal } from "../../topoLayerTypes";
import type { GeoJsonPolygonal } from "../../topoLayerTypes";

export type TopoJob = {
  id: string;
  status: TopoJobStatus;
  name: string | null;
  footprint: GeoJsonPolygonal | null;
  tileCount: number | null;
  estimatedSeconds: number | null;
  layerOptions: string[] | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  /** Owner-only: absent from a job shared WITH the user, because raw bucket
   *  keys can name a canyon (see serializeTopoJobFor in api/routes/topoJobs). */
  s3OutputKeys?:
    | { name: string; mbtilesKey: string; pmtilesKey: string | null }[]
    | null;
  /** Owner vs recipient — a job shared WITH the user is read-only. */
  syncRole: "owner" | "shared";
};

export type DownloadUrl = {
  name: string;
  mbtilesUrl: string;
  pmtilesUrl: string | null;
};

const INSTRUCTIONS_KEY = "topoDialogShowInstructions";

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

function bboxAreaKm2(bbox: TBbox): number {
  const R = 6371;
  const dLat = ((bbox.north - bbox.south) * Math.PI) / 180;
  const dLon = ((bbox.east - bbox.west) * Math.PI) / 180;
  const midLat = (((bbox.north + bbox.south) / 2) * Math.PI) / 180;
  return R * R * dLat * dLon * Math.cos(midLat);
}

/**
 * Generates a single-polygon shapefile ZIP (WGS84) from a bbox and triggers
 * a browser download. The ZIP contains the four standard shapefile components
 * (.shp, .shx, .dbf, .prj) and can be uploaded directly to ELVIS "Load File".
 *
 * The shapefile binary format is hand-written here to avoid a dependency.
 * Reference: ESRI Shapefile Technical Description (July 1998).
 */
function downloadBboxShapefile(bbox: TBbox) {
  const { west, south, east, north } = bbox;

  // Ring: 5 points (closed), clockwise
  const ring: [number, number][] = [
    [west, south],
    [west, north],
    [east, north],
    [east, south],
    [west, south],
  ];

  // ── .shp ────────────────────────────────────────────────────────────────
  // File header (100 bytes) + record header (8 bytes) + polygon content
  const numPoints = ring.length;
  // contentLength: size of record content in 16-bit words (per shapefile spec)
  //   shape type (Int32):        4 bytes =  2 words
  //   bbox (4 × Float64):       32 bytes = 16 words
  //   num parts (Int32):         4 bytes =  2 words
  //   num points (Int32):        4 bytes =  2 words
  //   parts[0] (Int32):          4 bytes =  2 words
  //   points (n × 2 × Float64): n×16 bytes = n×8 words
  const contentLength = 2 + 16 + 2 + 2 + 2 + numPoints * 8; // in 16-bit words
  const shpSize = 50 + 4 + contentLength; // in 16-bit words

  const shp = new DataView(new ArrayBuffer(shpSize * 2));
  let o = 0;

  // File header
  shp.setInt32(o, 9994, false);
  o += 4; // magic
  o += 20; // unused
  shp.setInt32(o, shpSize, false);
  o += 4; // file length (16-bit words)
  shp.setInt32(o, 1000, true);
  o += 4; // version
  shp.setInt32(o, 5, true);
  o += 4; // shape type: polygon
  shp.setFloat64(o, west, true);
  o += 8; // bbox
  shp.setFloat64(o, south, true);
  o += 8;
  shp.setFloat64(o, east, true);
  o += 8;
  shp.setFloat64(o, north, true);
  o += 8;
  o += 32; // Z/M ranges (zeros)

  // Record header
  shp.setInt32(o, 1, false);
  o += 4; // record number
  shp.setInt32(o, contentLength, false);
  o += 4; // content length (16-bit words)

  // Polygon record
  shp.setInt32(o, 5, true);
  o += 4; // shape type: polygon
  shp.setFloat64(o, west, true);
  o += 8;
  shp.setFloat64(o, south, true);
  o += 8;
  shp.setFloat64(o, east, true);
  o += 8;
  shp.setFloat64(o, north, true);
  o += 8;
  shp.setInt32(o, 1, true);
  o += 4; // num parts
  shp.setInt32(o, numPoints, true);
  o += 4; // num points
  shp.setInt32(o, 0, true);
  o += 4; // part 0 starts at index 0
  for (const [x, y] of ring) {
    shp.setFloat64(o, x, true);
    o += 8;
    shp.setFloat64(o, y, true);
    o += 8;
  }

  // ── .shx ────────────────────────────────────────────────────────────────
  const shx = new DataView(new ArrayBuffer(108));
  let sx = 0;
  shx.setInt32(sx, 9994, false);
  sx += 4;
  sx += 20;
  shx.setInt32(sx, 54, false);
  sx += 4; // file length: 50 header + 4 per record
  shx.setInt32(sx, 1000, true);
  sx += 4;
  shx.setInt32(sx, 5, true);
  sx += 4;
  shx.setFloat64(sx, west, true);
  sx += 8;
  shx.setFloat64(sx, south, true);
  sx += 8;
  shx.setFloat64(sx, east, true);
  sx += 8;
  shx.setFloat64(sx, north, true);
  sx += 8;
  sx += 32;
  shx.setInt32(sx, 50, false);
  sx += 4; // offset of record 1 (16-bit words)
  shx.setInt32(sx, contentLength, false); // content length of record 1

  // ── .dbf ────────────────────────────────────────────────────────────────
  // Minimal dBASE III+ with a single "name" field
  // Header: 32 (file header) + 32 (field descriptor) + 1 (terminator) = 65 bytes
  // Records: 1 record × (1 deletion flag + 10 char field) = 11 bytes
  // Total: 76 bytes
  const enc = new TextEncoder();
  const dbf = new Uint8Array(76);
  dbf[0] = 3; // version
  dbf[4] = 1; // num records (low byte)
  dbf[8] = 65; // header size in bytes (32 + 1×32 + 1)
  dbf[10] = 11; // record size (1 deletion flag + 10 chars)
  // Field descriptor at offset 32: NAME, type C, length 10
  dbf.set(enc.encode("NAME"), 32);
  dbf[32 + 11] = 67; // type 'C'
  dbf[32 + 16] = 10; // field length
  dbf[64] = 0x0d; // header terminator
  dbf[65] = 0x20; // deletion flag (space = not deleted)
  dbf.set(enc.encode("topo_area "), 66); // field value (10 chars, padded with space)

  // ── .prj ────────────────────────────────────────────────────────────────
  const prj = enc.encode(
    'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],' +
      'PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]',
  );

  // ── ZIP ─────────────────────────────────────────────────────────────────
  // Build a minimal ZIP manually (store, no compression)
  function zipEntry(name: string, data: Uint8Array, offset: number) {
    const nameBytes = enc.encode(name);
    // CRC-32
    let crc = 0xffffffff;
    for (const b of data) {
      crc ^= b;
      for (let i = 0; i < 8; i++)
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    crc = (crc ^ 0xffffffff) >>> 0;

    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); // local file header signature
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(8, 0, true); // compression: store
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true); // compressed size
    lv.setUint32(22, data.length, true); // uncompressed size
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); // central dir signature
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true); // offset of local header
    central.set(nameBytes, 46);

    return { local, central };
  }

  const files: { name: string; data: Uint8Array }[] = [
    { name: "topo_area.shp", data: new Uint8Array(shp.buffer) },
    { name: "topo_area.shx", data: new Uint8Array(shx.buffer) },
    { name: "topo_area.dbf", data: dbf },
    { name: "topo_area.prj", data: prj },
  ];

  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let localOffset = 0;

  for (const f of files) {
    const { local, central } = zipEntry(f.name, f.data, localOffset);
    locals.push(local);
    centrals.push(central);
    localOffset += local.length;
  }

  const centralOffset = localOffset;
  const centralSize = centrals.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, centralOffset, true);

  const total = [...locals, ...centrals, eocd].reduce(
    (s, a) => s + a.length,
    0,
  );
  const zip = new Uint8Array(total);
  let pos = 0;
  for (const a of [...locals, ...centrals, eocd]) {
    zip.set(a, pos);
    pos += a.length;
  }

  const blob = new Blob([zip], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "topo_area.zip";
  a.click();
  URL.revokeObjectURL(url);
}

// ── Component ────────────────────────────────────────────────────────────────

const outlinedAccentSx = {
  textTransform: "none",
  color: "var(--theme-accent)",
  borderColor: "var(--theme-accent)",
  "&:hover": {
    borderColor: "var(--theme-accent)",
    backgroundColor: "color-mix(in srgb, var(--theme-accent) 12%, transparent)",
  },
} as const;

export default function TopoDialog({
  open,
  onClose,
  onSelectBbox,
  pendingBbox,
  onJobCreated,
  initialTemplateId,
  existingTopoNames,
  onTemplateSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSelectBbox: () => void;
  pendingBbox: TBbox | null;
  onJobCreated: (job: TopoJob) => void;
  initialTemplateId?: string | null;
  existingTopoNames: string[];
  /** Notifies the owner that the inline "Save as template" created a template,
   *  so panel-side template lists can refetch (TOPO-1). */
  onTemplateSaved?: () => void;
}) {
  const isMobile = useIsMobile();
  const [file, setFile] = useState<File | null>(null);
  // Submission lifecycle: form → uploading (determinate PUT) → finalizing
  // (server validate + ECS launch) → done (in-dialog success).
  const [phase, setPhase] = useState<Phase>("form");
  const [uploadedBytes, setUploadedBytes] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const [submittedJob, setSubmittedJob] = useState<TopoJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [showInstructions, setShowInstructions] = useState(
    () => localStorage.getItem(INSTRUCTIONS_KEY) === "true",
  );
  const [validating, setValidating] = useState(false);
  const [stats, setStats] = useState<ElvisStats | null>(null);
  // Topo name: prefilled from the survey region after upload, but a name the
  // user types (topoNameTouched) is never overwritten by autofill.
  const [topoName, setTopoName] = useState("");
  const [topoNameTouched, setTopoNameTouched] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [creditsUsed, setCreditsUsed] = useState<number | null>(null);
  const [creditsQuota, setCreditsQuota] = useState<number | null>(null);
  const [creditsResetAt, setCreditsResetAt] = useState<string | null>(null);
  // What THIS job is projected to cost, from POST /compute-estimate. Null until
  // the ZIP has been validated (the tile count is the estimator's only input),
  // or when the server has too little history to have an opinion.
  const [jobCredits, setJobCredits] = useState<number | null>(null);
  // The server's own verdict on whether this submission would be refused.
  // Preferred over recomputing used + cost > quota on the client, so there is
  // one rule for the decision rather than two that can disagree.
  const [jobWouldExceed, setJobWouldExceed] = useState(false);
  const [storageUsed, setStorageUsed] = useState<number | null>(null);
  const [storageQuota, setStorageQuota] = useState<number | null>(null);

  // Advanced settings + templates
  const [settings, setSettings] = useState<RasterTemplateSettings>(() => cloneRasterTemplateSettings(RASTER_TEMPLATE_DEFAULTS));
  const [autoExport, setAutoExport] = useState<AutoExportSettings>(() => ({ ...AUTO_EXPORT_DEFAULTS }));
  const [templates, setTemplates] = useState<TopoTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(DEFAULT_TEMPLATE_ID);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [saveAsName, setSaveAsName] = useState("");
  const [showSaveAs, setShowSaveAs] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) return;
    setFile(null);
    setPhase("form");
    setUploadedBytes(0);
    setTotalBytes(0);
    setSubmittedJob(null);
    setError(null);
    setDragging(false);
    setValidating(false);
    setStats(null);
    setTopoName("");
    setTopoNameTouched(false);
    setValidationError(null);
    setSettings(cloneRasterTemplateSettings(RASTER_TEMPLATE_DEFAULTS));
    setAutoExport({ ...AUTO_EXPORT_DEFAULTS });
    setSelectedTemplateId(DEFAULT_TEMPLATE_ID);
    setAdvancedOpen(false);
    setSaveAsName("");
    setShowSaveAs(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [open]);

  const refreshTemplates = useCallback(async () => {
    try {
      const list = await fetchTopoTemplates();
      setTemplates(list);
      return list;
    } catch (e) {
      console.error(e);
      return [] as TopoTemplate[];
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    refreshTemplates().then((list) => {
      if (initialTemplateId) {
        const t = list.find((x) => x.id === initialTemplateId);
        if (t) {
          setSelectedTemplateId(t.id);
          setSettings(cloneRasterTemplateSettings(t.config));
          setAutoExport(cloneAutoExport(t.autoExport));
        }
      }
    });
  }, [open, refreshTemplates, initialTemplateId]);

  function selectTemplate(id: string) {
    setSelectedTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (t) {
      setSettings(cloneRasterTemplateSettings(t.config));
      setAutoExport(cloneAutoExport(t.autoExport));
    }
  }

  async function handleSaveAsTemplate() {
    const name = saveAsName.trim();
    if (!name) return;
    try {
      const created = await apiFetch<TopoTemplate>("/topo-templates", {
        method: "POST",
        body: { name, config: settings, autoExport },
      });
      setSaveAsName("");
      setShowSaveAs(false);
      await refreshTemplates();
      setSelectedTemplateId(created.id);
      // Panel-side template lists render from their own state — tell the owner
      // so they refresh without a page reload (TOPO-1).
      onTemplateSaved?.();
    } catch (e) {
      console.error(e);
      setError(messageFromError(e, "Couldn't save template."));
    }
  }

  // Tile count driving the cost projection: the ZIP's verified count once one
  // has been validated, else the drawn area's conservative estimate so the
  // warning appears before the user goes off to download gigabytes from ELVIS.
  const area = pendingBbox ? bboxAreaKm2(pendingBbox) : null;
  const estimatedTiles = area != null ? estimateElvisTileCount(area) : null;
  const activeTileCount = stats?.tileCount ?? estimatedTiles;

  // Credits are not derivable client-side: the tiles-to-seconds rate is fitted
  // server-side from recent real runtimes, so the projection has to be asked
  // for. Cheap (two DB reads, nothing written) and re-asked whenever the tile
  // count changes.
  useEffect(() => {
    if (!open || !activeTileCount) {
      setJobCredits(null);
      setJobWouldExceed(false);
      return;
    }
    let cancelled = false;
    fetchComputeEstimate({ kind: "topo", tileCount: activeTileCount })
      .then((estimate) => {
        if (cancelled) return;
        setJobCredits(estimate.credits);
        setJobWouldExceed(estimate.wouldExceed);
        // The estimate response carries a fresher balance than the one loaded
        // when the dialog opened, so adopt it rather than keeping two views.
        setCreditsUsed(estimate.used);
        setCreditsQuota(estimate.quota);
        setCreditsResetAt(estimate.resetAt);
      })
      // Same best-effort stance as the balance fetch below: display and
      // client-side gating only, the server still enforces on submit.
      .catch((err) => console.error(err));
    return () => {
      cancelled = true;
    };
  }, [open, activeTileCount]);

  useEffect(() => {
    if (!open) return;
    fetchCurrentUser()
      .then((u) => {
        setCreditsUsed(u.monthlyComputeUsage);
        setCreditsQuota(u.monthlyComputeCredits);
        setCreditsResetAt(u.monthlyComputeResetAt);
        setStorageUsed(u.storageUsedBytes);
        setStorageQuota(u.storageQuotaBytes);
      })
      // Best-effort: quota display/gating only — a failure here leaves
      // creditsUsed/creditsQuota null (the client-side checks then skip,
      // and the server still enforces the quota on submit), so it's not worth
      // a toast, but FEUI-011 wants the failure at least visible in the console
      // rather than fully silent.
      .catch((err) => console.error(err));
  }, [open]);

  useEffect(() => {
    if (!file) {
      setStats(null);
      setValidationError(null);
      return;
    }
    let cancelled = false;
    setValidating(true);
    setStats(null);
    setValidationError(null);
    (async () => {
      try {
        const tailSize = Math.min(65536, file.size);
        const tail = await file
          .slice(file.size - tailSize, file.size)
          .arrayBuffer();
        const entries = parseZipCentralDirectory(
          new Uint8Array(tail),
          file.size,
        );
        const s = classifyElvisEntries(entries);
        if (!cancelled) setStats(s);
      } catch (e) {
        if (!cancelled) {
          setValidationError(
            e instanceof ElvisZipError
              ? e.message
              : "Could not read this ZIP file.",
          );
        }
      } finally {
        if (!cancelled) setValidating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file]);

  // Prefill the topo name from the survey region once a ZIP is parsed, unless
  // the user has already typed one. Re-fills on a new upload only while
  // untouched.
  useEffect(() => {
    if (!stats || topoNameTouched) return;
    const region = regionNameFromSurvey(stats.surveyNames[0] ?? "");
    if (region) setTopoName(nextTopoName(region, existingTopoNames));
  }, [stats, topoNameTouched, existingTopoNames]);

  function onFilePicked(picked: File) {
    if (!picked.name.toLowerCase().endsWith(".zip")) {
      setValidationError("Please select a .zip file.");
      return;
    }
    setFile(picked);
    setError(null);
  }

  function toggleInstructions() {
    setShowInstructions((prev) => {
      const next = !prev;
      localStorage.setItem(INSTRUCTIONS_KEY, String(next));
      return next;
    });
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(true);
  }

  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) onFilePicked(dropped);
  }

  async function handleSubmit() {
    if (!file || !stats) return;
    setError(null);

    if (storageUsed !== null && storageQuota !== null && storageUsed >= storageQuota) {
      setError("Storage quota is full. Free space by deleting old topo jobs before submitting a new one.");
      return;
    }

    if (creditsUsed !== null && creditsQuota !== null && jobCredits !== null) {
      if (creditsUsed + jobCredits > creditsQuota) {
        const remaining = Math.max(0, creditsQuota - creditsUsed);
        const resetStr = creditsResetAt
          ? ` Allowance resets ${new Date(creditsResetAt).toLocaleDateString("en-AU", { month: "short", day: "numeric" })}.`
          : "";
        setError(
          `Not enough processing credits. This job needs about ${formatCredits(jobCredits)} but only ${formatCredits(remaining)} remain.${resetStr}`,
        );
        return;
      }
    }

    setUploadedBytes(0);
    setTotalBytes(file.size);
    setPhase("uploading");
    try {
      const { jobId, uploadUrl } = await apiFetch<{
        jobId: string;
        uploadUrl: string;
      }>("/topo-jobs", {
        method: "POST",
        body: {
          tileCount: stats.tileCount || null,
          jobName: topoName.trim() || stats.surveyNames[0] || null,
          filename: file.name,
          settings,
          autoExport,
        },
      });

      await putToPresignedUrl(uploadUrl, file, "application/zip", (loaded, total) => {
        setUploadedBytes(loaded);
        setTotalBytes(total);
      });

      setPhase("finalizing");
      await apiFetch(`/topo-jobs/${jobId}/start`, { method: "POST" });

      const newJob = await apiFetch<TopoJob>(`/topo-jobs/${jobId}`);
      onJobCreated(newJob);
      setSubmittedJob(newJob);
      setPhase("done");
    } catch (e: unknown) {
      console.error(e);
      setError(messageFromError(e, "Submission failed. Please try again."));
      // File preserved so the ErrorBanner's Retry can resubmit.
      setPhase("form");
    }
  }

  function performClose() {
    // Block closing mid-upload — there's no resumable state to return to.
    if (phase === "uploading" || phase === "finalizing") return;
    onClose();
  }

  // Dirty once a ZIP has been picked and not yet submitted — losing a queued
  // multi-GB upload to a stray Esc is real lost work. Deliberately keyed to the
  // file only: settings/name have an async baseline (a template can apply after
  // open via initialTemplateId, and picking a template mutates settings), so a
  // settings snapshot would false-positive; the confirm copy is narrowed to
  // match exactly what this guards. Once submission starts (uploading/
  // finalizing) close is already blocked above; once done there's nothing left
  // to lose.
  const isDirty = phase === "form" && file != null;
  const guard = useUnsavedChangesGuard(isDirty, performClose);

  const uploadPct = totalBytes > 0 ? Math.min(100, Math.round((uploadedBytes / totalBytes) * 100)) : 0;

  return (
    <>
    <Dialog
      fullScreen={isMobile}
      open={open}
      onClose={guard.requestClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          backgroundColor: "var(--theme-primary)",
          color: "var(--theme-text-primary)",
          maxHeight: isMobile ? "100%" : "85vh",
        },
      }}
    >
      <DialogTitle
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        {phase === "uploading"
          ? "Uploading…"
          : phase === "finalizing"
            ? "Finalizing…"
            : phase === "done"
              ? "Submitted"
              : "Generate Topo Map"}
        {phase !== "uploading" && phase !== "finalizing" && (
          <IconButton
            aria-label="Close dialog"
            onClick={guard.requestClose}
            size="small"
            sx={{ color: "var(--theme-text-primary)" }}
          >
            <CloseIcon />
          </IconButton>
        )}
      </DialogTitle>

      <DialogContent dividers sx={{ borderColor: "rgba(255,255,255,0.1)" }}>
        {phase === "uploading" || phase === "finalizing" ? (
          <Box sx={{ py: 3 }}>
            <Typography variant="body2" sx={{ mb: 1.5 }}>
              {phase === "uploading"
                ? "Uploading LiDAR data… keep this dialog open."
                : "Upload complete. Validating and starting your topo job…"}
            </Typography>
            <LinearProgress
              variant={phase === "uploading" ? "determinate" : "indeterminate"}
              value={phase === "uploading" ? uploadPct : undefined}
              sx={{
                height: 8,
                borderRadius: "var(--radius-sm)",
                backgroundColor: "rgba(255,255,255,0.08)",
                "& .MuiLinearProgress-bar": { backgroundColor: "var(--theme-accent)" },
              }}
            />
            {phase === "uploading" && (
              <Typography
                variant="caption"
                sx={{ display: "block", mt: 1, color: "var(--theme-text-muted)" }}
              >
                {(uploadedBytes / 1e6).toFixed(1)} / {(totalBytes / 1e6).toFixed(1)} MB
                {totalBytes > 0 ? ` (${uploadPct}%)` : ""}
              </Typography>
            )}
          </Box>
        ) : phase === "done" ? (
          <Box sx={{ py: 3, textAlign: "center" }}>
            <CheckCircleIcon sx={{ fontSize: 48, color: "var(--theme-accent)", mb: 1 }} />
            <Typography variant="h6" sx={{ mb: 0.5 }}>
              {submittedJob?.name ?? "Topo job"} submitted
            </Typography>
            {stats?.tileCount ? (
              <Typography variant="body2" sx={{ color: "var(--theme-text-muted)", mb: 0.5 }}>
                {stats.tileCount} tile{stats.tileCount > 1 ? "s" : ""} queued
              </Typography>
            ) : null}
            <Typography variant="body2" sx={{ color: "var(--theme-text-muted)" }}>
              Processing has started — you'll be notified when your topo is ready.
            </Typography>
          </Box>
        ) : (
        <>
        {isMobile && (
          <Typography
            variant="caption"
            sx={{ display: "block", mb: 1.5, color: "var(--theme-text-muted)" }}
          >
            This tool is best used on a larger screen.
          </Typography>
        )}
        {/* ── Instructions toggle ── */}
        <Box
          component="button"
          onClick={toggleInstructions}
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--theme-text-muted)",
            fontSize: "0.8rem",
            p: 0,
            mb: 2,
            "&:hover": { color: "var(--theme-text-primary)" },
            transition: "color var(--transition-fast)",
          }}
        >
          {showInstructions ? (
            <ExpandLessIcon sx={{ fontSize: 16 }} />
          ) : (
            <ExpandMoreIcon sx={{ fontSize: 16 }} />
          )}
          {showInstructions ? "Hide instructions" : "How to get an ELVIS ZIP"}
        </Box>

        {/* ── Collapsible instructions ── */}
        <Collapse in={showInstructions}>
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              gap: 1,
              mb: 2,
              pl: 1,
            }}
          >
            {/* Step 1: Draw area + shapefile */}
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1.5,
                flexWrap: "wrap",
              }}
            >
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ minWidth: 16 }}
              >
                1.
              </Typography>
              <Button
                size="small"
                variant="outlined"
                onClick={onSelectBbox}
                sx={outlinedAccentSx}
              >
                Draw area on map
              </Button>
              {pendingBbox ? (
                <>
                  <Chip
                    size="small"
                    label={area != null ? formatAreaKm2(area) : ""}
                    variant="outlined"
                    sx={{
                      color: "var(--theme-text-muted)",
                      borderColor: "var(--theme-text-muted)",
                    }}
                  />
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => downloadBboxShapefile(pendingBbox)}
                    sx={outlinedAccentSx}
                  >
                    Download shapefile
                  </Button>
                </>
              ) : (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ fontStyle: "italic" }}
                >
                  then download shapefile
                </Typography>
              )}
            </Box>

            {jobWouldExceed && stats === null && (
              <Typography
                variant="body2"
                sx={{
                  fontStyle: "italic",
                  color: "var(--theme-warning)",
                  pl: 3.5,
                  mt: -0.5,
                }}
              >
                This area may exceed your remaining processing credits — try a
                smaller area.
              </Typography>
            )}

            {/* Step 2: Open ELVIS portal */}
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ minWidth: 16 }}
              >
                2.
              </Typography>
              <Button
                size="small"
                variant="outlined"
                href="https://elevation.fsdf.org.au/"
                target="_blank"
                rel="noopener noreferrer"
                sx={outlinedAccentSx}
              >
                Open ELVIS portal ↗
              </Button>
            </Box>

            {/* Step 3: Load file + search */}
            <Box sx={{ display: "flex", gap: 1.5, alignItems: "flex-start" }}>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ minWidth: 16 }}
              >
                3.
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Click 'Order Data' → draw your area or 'Load File' to upload a
                shapefile, then click 'Search'.
              </Typography>
              <Tooltip
                title={
                  <>
                    <strong>Point cloud = full output.</strong> A LiDAR point
                    cloud generates every layer (terrain, vegetation, contours).
                    Any ELVIS DEM (Digital Elevation Model) bundled alongside it
                    is ignored, so there's no need to add one.
                    <br />
                    <br />
                    <strong>No point cloud available?</strong> Select{" "}
                    <em>only</em> DEM files — terrain and contours are generated,
                    but the vegetation density layer is not.
                  </>
                }
                arrow
                placement="right"
              >
                <InfoOutlinedIcon
                  fontSize="small"
                  sx={{
                    color: "var(--theme-text-muted)",
                    cursor: "help",
                    flexShrink: 0,
                    mt: "2px",
                  }}
                />
              </Tooltip>
            </Box>

            {/* Step 4: Select point clouds */}
            <Box sx={{ display: "flex", gap: 1.5 }}>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ minWidth: 16 }}
              >
                4.
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Under 'NSW Government - Spatial Services' → 'Point Clouds',
                beside 'AHD', click 'Select all'.
              </Typography>
            </Box>

            {/* Step 5: Order datasets */}
            <Box sx={{ display: "flex", gap: 1.5 }}>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ minWidth: 16 }}
              >
                5.
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Under 'Industry', select 'Recreation'. Enter your email and
                click 'Order x Datasets'.
              </Typography>
            </Box>
          </Box>
        </Collapse>

        {/* ── Upload zone (hero) ── */}
        <Box
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          sx={{
            border: `2px dashed ${dragging ? "var(--theme-accent)" : "rgba(255,255,255,0.18)"}`,
            borderRadius: "var(--radius-md)",
            p: 3,
            textAlign: "center",
            cursor: "pointer",
            backgroundColor: dragging
              ? "color-mix(in srgb, var(--theme-accent) 8%, transparent)"
              : "rgba(255,255,255,0.02)",
            transition:
              "border-color var(--transition-fast), background-color var(--transition-fast)",
            "&:hover": {
              borderColor: "var(--theme-accent)",
              backgroundColor:
                "color-mix(in srgb, var(--theme-accent) 8%, transparent)",
            },
          }}
        >
          <UploadFileIcon
            sx={{
              fontSize: 36,
              color: file ? "var(--theme-accent)" : "var(--theme-text-muted)",
              mb: 0.5,
            }}
          />
          <Typography
            variant="body2"
            sx={{
              color: file
                ? "var(--theme-text-primary)"
                : "var(--theme-text-muted)",
            }}
          >
            {file ? file.name : "Drop ELVIS ZIP here, or click to browse"}
          </Typography>
          {file && (
            <Typography variant="caption" color="text.secondary">
              Click to change file
            </Typography>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip"
            hidden
            onChange={(e) => {
              const picked = e.target.files?.[0];
              if (picked) onFilePicked(picked);
              e.target.value = "";
            }}
          />
        </Box>

        {/* Validation spinner */}
        {validating && (
          <Box
            sx={{
              mt: 1.5,
              display: "flex",
              alignItems: "center",
              gap: 1,
              color: "var(--theme-text-muted)",
            }}
          >
            <CircularProgress size={14} />
            <Typography variant="caption">Checking ZIP…</Typography>
          </Box>
        )}

        {/* ZIP stats panel */}
        {stats && !validating && (
          <Box
            sx={{
              mt: 1.5,
              p: 1.5,
              borderRadius: "var(--radius-sm)",
              backgroundColor: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.1)",
              display: "grid",
              gridTemplateColumns: "auto 1fr",
              columnGap: 2,
              rowGap: 0.5,
            }}
          >
            {(
              [
                ["Survey", stats.surveyNames.join(", ") || "—"],
                ["Mode", stats.modeLabel],
                ["Tiles", String(stats.tileCount)],
                stats.lazCount > 0
                  ? [
                      "Point clouds",
                      stats.overlappingSurveys
                        ? `${stats.lazCount}× .laz over ${stats.tileCount} area${stats.tileCount > 1 ? "s" : ""}`
                        : `${stats.lazCount}× .laz`,
                    ]
                  : null,
                stats.demCount > 0
                  ? [
                      "DEM",
                      `${stats.demCount}× .tif${stats.demResolutionMeters != null ? ` @ ${stats.demResolutionMeters}m` : ""}`,
                    ]
                  : null,
                ["Size", formatBytes(stats.uncompressedBytes)],
                // Unambiguous quota copy (TOPO-8): creditsUsed already includes
                // any queued/running jobs (the server sums non-failed jobs
                // this month), so show the current figure and the projection
                // side by side instead of a bare "N / Q after this job".
                creditsUsed !== null && creditsQuota !== null
                  ? [
                      "Processing credits",
                      jobCredits !== null
                        ? `${formatCredits(creditsUsed)} of ${formatCredits(creditsQuota)} used · about ${formatCredits(jobCredits)} for this job`
                        : `${formatCredits(creditsUsed)} of ${formatCredits(creditsQuota)} used · cost for this job not yet known`,
                    ]
                  : null,
              ] as ([string, string] | null)[]
            )
              .filter((row): row is [string, string] => row !== null)
              .map(([label, value]) => (
                <Fragment key={label}>
                  <Typography
                    variant="caption"
                    sx={{ color: "var(--theme-text-muted)" }}
                  >
                    {label}
                  </Typography>
                  <Typography variant="caption">{value}</Typography>
                </Fragment>
              ))}
            {stats.derivativeTifCount > 0 && (
              <Typography
                variant="caption"
                sx={{
                  gridColumn: "1 / -1",
                  mt: 0.5,
                  fontStyle: "italic",
                  color: "var(--theme-text-muted)",
                }}
              >
                {stats.derivativeTifCount} derivative raster
                {stats.derivativeTifCount > 1 ? "s" : ""} (hillshade etc.) will
                be ignored
              </Typography>
            )}
            {stats.overlappingSurveys && (
              <Typography
                variant="caption"
                sx={{
                  gridColumn: "1 / -1",
                  mt: 0.5,
                  fontStyle: "italic",
                  color: "var(--theme-text-muted)",
                }}
              >
                Overlapping surveys detected — the best survey is picked per
                layer (densest for terrain, most recent for vegetation). Uses no
                extra tile quota.
              </Typography>
            )}
          </Box>
        )}

        {(validationError || error) && (
          <ErrorBanner message={validationError ?? error!} />
        )}

        {/* ── Topo name ── */}
        <TextField
          size="small"
          fullWidth
          label="Topo name"
          placeholder="Name this topo"
          value={topoName}
          onChange={(e) => {
            setTopoName(e.target.value);
            setTopoNameTouched(true);
          }}
          sx={{ ...fieldSx, mt: 2 }}
        />

        {/* ── Template selector + Save as / Manage ── */}
        <Box sx={{ mt: 2, display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
          <Typography variant="caption" sx={{ color: "var(--theme-text-muted)" }}>
            Template
          </Typography>
          <Select
            size="small"
            value={selectedTemplateId}
            onChange={(e) => selectTemplate(String(e.target.value))}
            MenuProps={{
              PaperProps: {
                sx: {
                  backgroundColor: "var(--theme-primary)",
                  color: "var(--theme-text-primary)",
                },
              },
            }}
            sx={{
              minWidth: 180,
              color: "var(--theme-text-primary)",
              "& .MuiOutlinedInput-notchedOutline": { borderColor: "var(--theme-accent)" },
            }}
          >
            {/* Until /topo-templates resolves, render the synthetic system
                Default entry (always first in the server list) so the Select's
                initial value "default" is never out of range (TOPO-3). */}
            {templates.length === 0 ? (
              <MenuItem value={DEFAULT_TEMPLATE_ID}>Default (system)</MenuItem>
            ) : (
              templates.map((t) => (
                <MenuItem key={t.id} value={t.id}>
                  {t.name}{t.isSystem ? " (system)" : ""}
                </MenuItem>
              ))
            )}
          </Select>
        </Box>

        {/* ── Advanced settings accordion ── */}
        <Accordion
          expanded={advancedOpen}
          onChange={(_, expanded) => {
            setAdvancedOpen(expanded);
            if (!expanded) {
              setShowSaveAs(false);
              setSaveAsName("");
            }
          }}
          sx={{
            mt: 2,
            backgroundColor: "rgba(255,255,255,0.04)",
            color: "var(--theme-text-primary)",
            "& .MuiAccordionSummary-root": { minHeight: 40 },
          }}
        >
          {/* No interactive children in the summary: AccordionSummary renders
              as a <button>, so a nested Button is invalid DOM (TOPO-1). The
              "Save as template" action lives in the details instead. */}
          <AccordionSummary
            expandIcon={<ExpandMoreIcon sx={{ color: "var(--theme-text-primary)" }} />}
          >
            <Typography variant="body2">Advanced settings</Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ pt: 0 }}>
            <Box sx={{ mb: 1.5, display: "flex", justifyContent: "flex-end" }}>
              <Button
                size="small"
                variant="outlined"
                sx={outlinedAccentSx}
                onClick={() => setShowSaveAs((v) => !v)}
              >
                Save as template
              </Button>
            </Box>
            {showSaveAs && (
              <Box sx={{ mb: 1.5, display: "flex", gap: 1, alignItems: "center" }}>
                <TextField
                  size="small"
                  placeholder="Template name"
                  value={saveAsName}
                  onChange={(e) => setSaveAsName(e.target.value)}
                  sx={{
                    flex: 1,
                    "& .MuiInputBase-input": { color: "var(--theme-text-primary)" },
                    "& .MuiOutlinedInput-notchedOutline": { borderColor: "var(--theme-accent)" },
                  }}
                />
                <Button
                  size="small"
                  variant="contained"
                  color="secondary"
                  disabled={
                    !saveAsName.trim() ||
                    slopeBandsError(settings.slope.bands) != null ||
                    hillshadeSettingsError(settings.hillshade) != null
                  }
                  onClick={handleSaveAsTemplate}
                >
                  Save
                </Button>
                <Button
                  size="small"
                  onClick={() => { setShowSaveAs(false); setSaveAsName(""); }}
                  sx={{ color: "var(--theme-text-primary)" }}
                >
                  Cancel
                </Button>
              </Box>
            )}
            <AdvancedSettings
              value={settings}
              onChange={setSettings}
              autoExport={autoExport}
              onAutoExportChange={setAutoExport}
            />
          </AccordionDetails>
        </Accordion>
        </>
        )}
      </DialogContent>

      <DialogActions>
        {phase === "done" ? (
          <Button variant="contained" color="secondary" onClick={onClose}>
            Done
          </Button>
        ) : phase === "uploading" || phase === "finalizing" ? (
          <Button disabled sx={{ color: "var(--theme-text-primary)" }}>
            <CircularProgress size={18} />
          </Button>
        ) : (
          <>
            <Button
              onClick={guard.requestClose}
              sx={{ color: "var(--theme-text-primary)" }}
            >
              Cancel
            </Button>
            <Button
              variant="contained"
              color="secondary"
              onClick={handleSubmit}
              disabled={
                !file ||
                validating ||
                !stats ||
                !!validationError ||
                slopeBandsError(settings.slope.bands) != null ||
                hillshadeSettingsError(settings.hillshade) != null ||
                (creditsUsed !== null &&
                  creditsQuota !== null &&
                  jobCredits !== null &&
                  creditsUsed + jobCredits > creditsQuota)
              }
            >
              Submit
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>

    <ConfirmDialog
      open={guard.guardOpen}
      title="Discard unsaved changes?"
      message="Your loaded file will be lost."
      confirmLabel="Discard"
      confirmColor="error"
      onConfirm={guard.confirmDiscard}
      onClose={guard.cancelDiscard}
    />
    </>
  );
}
