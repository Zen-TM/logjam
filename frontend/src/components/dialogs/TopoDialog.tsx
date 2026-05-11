import { useState, useRef, Fragment } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Checkbox,
  FormControlLabel,
  FormGroup,
  Typography,
  Box,
  CircularProgress,
  LinearProgress,
  Chip,
  IconButton,
  Divider,
  Alert,
  Tooltip,
  Collapse,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import { apiFetch } from "../../canyonUtils";
import { MASTER_TOPO_LAYERS } from "../../topoLayerTypes";

// ── Types ────────────────────────────────────────────────────────────────────

export type TopoJobStatus =
  | "uploading"
  | "pending"
  | "processing"
  | "complete"
  | "failed";

export type GeoJsonPolygon = {
  type: string;
  coordinates: number[][][];
};

export type TopoJob = {
  id: string;
  status: TopoJobStatus;
  name: string | null;
  footprint: GeoJsonPolygon | null;
  tileCount: number | null;
  estimatedSeconds: number | null;
  layerOptions: string[] | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  s3OutputKeys:
    | { name: string; mbtilesKey: string; pmtilesKey: string }[]
    | null;
};

export type DownloadUrl = {
  name: string;
  mbtilesUrl: string;
  pmtilesUrl: string | null;
};

// ── Constants ────────────────────────────────────────────────────────────────

const ALL_LAYERS = [
  ...MASTER_TOPO_LAYERS.map((l) => l.name),
  "composite",
] as const;
type LayerName = (typeof ALL_LAYERS)[number];

const LAYER_LABELS: Record<LayerName, string> = {
  ...Object.fromEntries(MASTER_TOPO_LAYERS.map((l) => [l.name, l.label])),
  features: "Features (OSM overlay)",
  composite: "Composite (all layers combined)",
} as Record<LayerName, string>;

const INSTRUCTIONS_KEY = "topoDialogShowInstructions";

async function parseElvisZip(
  file: File,
): Promise<{ tileCount: number; jobName: string | null }> {
  const tail = await file.slice(file.size - 22, file.size).arrayBuffer();
  const eocd = new DataView(tail);
  if (eocd.getUint32(0, true) !== 0x06054b50) return { tileCount: 0, jobName: null };
  const cdOffset = eocd.getUint32(16, true);
  const cdSize = eocd.getUint32(12, true);
  const cdBuf = await file.slice(cdOffset, cdOffset + cdSize).arrayBuffer();
  const cd = new DataView(cdBuf);
  let tileCount = 0;
  const nameFreq: Record<string, number> = {};
  let pos = 0;
  while (pos < cdBuf.byteLength - 4) {
    if (cd.getUint32(pos, true) !== 0x02014b50) break;
    const fnLen = cd.getUint16(pos + 28, true);
    const extraLen = cd.getUint16(pos + 30, true);
    const commentLen = cd.getUint16(pos + 32, true);
    const fn = new TextDecoder().decode(new Uint8Array(cdBuf, pos + 46, fnLen));
    if (fn.toLowerCase().endsWith(".laz") || fn.toLowerCase().endsWith(".las")) {
      tileCount++;
      const base = (fn.split("/").pop() ?? fn).replace(/\.[^.]+$/, "");
      const match = base.match(/^([A-Za-z]+)/);
      if (match) nameFreq[match[1]] = (nameFreq[match[1]] ?? 0) + 1;
    }
    pos += 46 + fnLen + extraLen + commentLen;
  }
  let jobName: string | null = null;
  let maxCount = 0;
  for (const [name, count] of Object.entries(nameFreq)) {
    if (count > maxCount) { maxCount = count; jobName = name; }
  }
  return { tileCount, jobName };
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
  onLayersToggle,
  jobs,
  downloadUrlsMap,
  onJobCreated,
}: {
  open: boolean;
  onClose: () => void;
  onLayersToggle: (layers: { id: string; pmtilesUrl: string }[]) => void;
  jobs: TopoJob[];
  downloadUrlsMap: Record<string, DownloadUrl[]>;
  onJobCreated: (job: TopoJob) => void;
}) {
  const [selectedLayers, setSelectedLayers] = useState<Set<LayerName>>(
    new Set(["composite"]),
  );
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [showInstructions, setShowInstructions] = useState(
    () => localStorage.getItem(INSTRUCTIONS_KEY) === "true",
  );

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Per-session overlay toggle state (which job layers are shown on the map)
  const [overlayIds, setOverlayIds] = useState<Set<string>>(new Set());
  const overlayLayersRef = useRef<{ id: string; pmtilesUrl: string }[]>([]);

  function toggleLayer(name: LayerName) {
    setSelectedLayers((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
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
    if (dropped?.name.toLowerCase().endsWith(".zip")) {
      setFile(dropped);
    }
  }

  async function handleSubmit() {
    if (!file) return;
    setError(null);
    setSubmitting(true);
    try {
      const layers = [...selectedLayers];
      const { tileCount, jobName } = await parseElvisZip(file);
      const { jobId, uploadUrl } = await apiFetch<{
        jobId: string;
        uploadUrl: string;
      }>("/topo-jobs", {
        method: "POST",
        body: {
          tileCount: tileCount || null,
          jobName: jobName || null,
          layerOptions: layers,
          filename: file.name,
        },
      });

      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": "application/zip" },
      });
      if (!uploadRes.ok) throw new Error("ZIP upload failed");

      await apiFetch(`/topo-jobs/${jobId}/start`, { method: "POST" });

      const newJob = await apiFetch<TopoJob>(`/topo-jobs/${jobId}`);
      onJobCreated(newJob);
      setFile(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  }

  function toggleMapOverlay(jobId: string, url: DownloadUrl) {
    const layerId = `${jobId}-${url.name}`;
    setOverlayIds((prev) => {
      const next = new Set(prev);
      if (next.has(layerId)) {
        next.delete(layerId);
      } else {
        next.add(layerId);
      }
      // Rebuild overlay layers list across all jobs
      const newLayers: { id: string; pmtilesUrl: string }[] = [];
      for (const [jid, urls] of Object.entries(downloadUrlsMap)) {
        for (const u of urls) {
          if (u.pmtilesUrl && next.has(`${jid}-${u.name}`)) {
            newLayers.push({
              id: `${jid}-${u.name}`,
              pmtilesUrl: u.pmtilesUrl,
            });
          }
        }
      }
      overlayLayersRef.current = newLayers;
      onLayersToggle(newLayers);
      return next;
    });
  }

  function handleClose() {
    if (submitting) return;
    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
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
        }}
      >
        Generate Topo Map
        <IconButton
          onClick={handleClose}
          size="small"
          sx={{ color: "var(--theme-text-primary)" }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers sx={{ borderColor: "rgba(255,255,255,0.1)" }}>
        {/* ── Job status list ── */}
        {jobs.filter((j) => j.status !== "complete").length > 0 && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle2" gutterBottom>
              Jobs
            </Typography>
            {jobs.filter((j) => j.status !== "complete").map((j) => {
              const urls = downloadUrlsMap[j.id] ?? null;
              const isRunning =
                j.status === "pending" || j.status === "processing";
              const isComplete = j.status === "complete";
              const isFailed = j.status === "failed";
              return (
                <Box key={j.id} sx={{ mb: 1.5 }}>
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 1,
                      mb: 0.5,
                    }}
                  >
                    {isRunning && <CircularProgress size={14} />}
                    <Chip
                      size="small"
                      label={
                        j.status === "pending"
                          ? "Queued"
                          : j.status === "processing"
                            ? "Processing"
                            : j.status === "complete"
                              ? "Complete"
                              : "Failed"
                      }
                      color={
                        isComplete ? "success" : isFailed ? "error" : "default"
                      }
                    />
                    {j.name && (
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        {j.name}
                      </Typography>
                    )}
                    {isRunning && j.estimatedSeconds != null && (
                      <Typography variant="caption" color="text.secondary">
                        ~{Math.round(j.estimatedSeconds / 60)} min
                      </Typography>
                    )}
                  </Box>
                  {isRunning && <LinearProgress sx={{ mb: 0.5 }} />}
                  {isFailed && (
                    <Typography variant="caption" color="error">
                      {j.errorMessage ?? "Unknown error"}
                    </Typography>
                  )}
                  {isComplete && urls && (
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                      {urls.map((u) => {
                        const layerId = `${j.id}-${u.name}`;
                        return (
                          <Fragment key={u.name}>
                            <Button
                              size="small"
                              variant="outlined"
                              href={u.mbtilesUrl}
                              download={`${u.name}.mbtiles`}
                              sx={outlinedAccentSx}
                            >
                              {u.name}.mbtiles
                            </Button>
                            {u.pmtilesUrl && (
                              <Button
                                size="small"
                                variant={
                                  overlayIds.has(layerId)
                                    ? "contained"
                                    : "outlined"
                                }
                                color={
                                  overlayIds.has(layerId)
                                    ? "secondary"
                                    : undefined
                                }
                                onClick={() => toggleMapOverlay(j.id, u)}
                                sx={
                                  overlayIds.has(layerId)
                                    ? { textTransform: "none" }
                                    : outlinedAccentSx
                                }
                              >
                                {overlayIds.has(layerId)
                                  ? "Hide on map"
                                  : "Show on map"}
                              </Button>
                            )}
                          </Fragment>
                        );
                      })}
                    </Box>
                  )}
                </Box>
              );
            })}
            <Divider
              sx={{ mt: 1, mb: 2, borderColor: "rgba(255,255,255,0.1)" }}
            />
          </Box>
        )}

        {/* ── Layer selection ── */}
        <Typography variant="subtitle2" gutterBottom>
          Select layers
        </Typography>
        <FormGroup>
          {ALL_LAYERS.map((name) => (
            <FormControlLabel
              key={name}
              control={
                <Checkbox
                  checked={selectedLayers.has(name)}
                  onChange={() => toggleLayer(name)}
                  size="small"
                  sx={{
                    color: "var(--theme-accent)",
                    "&.Mui-checked": { color: "var(--theme-accent)" },
                  }}
                />
              }
              label={LAYER_LABELS[name]}
            />
          ))}
        </FormGroup>

        <Divider sx={{ my: 2, borderColor: "rgba(255,255,255,0.1)" }} />

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
            {/* Step 1: Open ELVIS portal */}
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
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
                href="https://elevation.fsdf.org.au/"
                target="_blank"
                rel="noopener noreferrer"
                sx={outlinedAccentSx}
              >
                Open ELVIS portal ↗
              </Button>
            </Box>

            {/* Step 2: Load file + search */}
            <Box sx={{ display: "flex", gap: 1.5, alignItems: "flex-start" }}>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ minWidth: 16 }}
              >
                2.
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Click 'Order Data' → draw your area or 'Load File' to upload a
                shapefile, then click 'Search'.
              </Typography>
              <Tooltip
                title={
                  <>
                    <strong>Faster processing:</strong> You can also include
                    ELVIS DEM (Digital Elevation Model) files alongside the
                    point cloud. DEM files must cover the entire selected area.
                    <br />
                    <br />
                    <strong>Fastest (no vegetation layer):</strong> Select{" "}
                    <em>only</em> DEM files — no point cloud needed. The
                    vegetation density layer will not be generated.
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

            {/* Step 3: Select point clouds */}
            <Box sx={{ display: "flex", gap: 1.5 }}>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ minWidth: 16 }}
              >
                3.
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Under 'NSW Government - Spatial Services' → 'Point Clouds',
                beside 'AHD', click 'Select all'.
              </Typography>
            </Box>

            {/* Step 4: Order datasets */}
            <Box sx={{ display: "flex", gap: 1.5 }}>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ minWidth: 16 }}
              >
                4.
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
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </Box>

        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </DialogContent>

      <DialogActions>
        <Button
          onClick={handleClose}
          disabled={submitting}
          sx={{ color: "var(--theme-text-primary)" }}
        >
          Cancel
        </Button>
        <Button
          variant="contained"
          color="secondary"
          onClick={handleSubmit}
          disabled={!file || submitting}
        >
          {submitting ? <CircularProgress size={18} /> : "Submit"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
