import { useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  IconButton,
  Typography,
  FormControl,
  FormControlLabel,
  Checkbox,
  RadioGroup,
  Radio,
  CircularProgress,
  Tooltip,
  Box,
  Chip,
  List,
  ListItem,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import DownloadIcon from "@mui/icons-material/Download";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import {
  EXPORT_FORMAT_RULES,
  validateExportRequest,
  type ExportFormat,
  type ExportBundling,
  type TopoLayerKey,
} from "@logjam/shared";
import { apiFetch, deleteTopoExport, useTopoExports } from "../../canyonUtils";
import { messageFromError } from "../../errors/messageFromError";
import { ErrorBanner } from "../feedback/ErrorBanner";
import { TOPO_LAYERS, type CompletedTopoJob } from "../../topoLayerTypes";

interface Props {
  open: boolean;
  onClose: () => void;
  job: CompletedTopoJob | null;
}

const FORMAT_ORDER: ExportFormat[] = ["mbtiles", "geotiff", "gpkg", "geojson", "gpx"];

const INITIAL_FORMAT: ExportFormat = "mbtiles";

const VECTOR_STYLE_TOOLTIP =
  "Each export freezes your vector style at the instant you press Start export. Editing the style afterwards does not change exports already in the list — re-export to apply new styling. The timestamp on each recent export is when its style was snapshotted.";

// Layers eligible for a given format, per EXPORT_FORMAT_RULES.
function layersForFormat(format: ExportFormat): Set<TopoLayerKey> {
  const rule = EXPORT_FORMAT_RULES[format];
  const next = new Set<TopoLayerKey>();
  for (const meta of TOPO_LAYERS) {
    if (meta.format === "raster" && rule.allowRaster) next.add(meta.name as TopoLayerKey);
    if (meta.format === "vector" && rule.allowVector) next.add(meta.name as TopoLayerKey);
  }
  return next;
}

function formatBytes(n: number | null): string {
  if (n === null) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

// Programmatically trigger a browser download for a presigned URL.
function triggerDownload(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export default function TopoExportDialog({ open, onClose, job }: Props) {
  const [format, setFormat] = useState<ExportFormat>(INITIAL_FORMAT);
  const [bundling, setBundling] = useState<ExportBundling>("composite");
  const [selected, setSelected] = useState<Set<TopoLayerKey>>(() => layersForFormat(INITIAL_FORMAT));
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Poll while dialog is open so users see status flip from queued → completed.
  const { exports, loading: exportsLoading, refetch: refetchExports } = useTopoExports(open, open ? 5000 : 0);

  const rule = EXPORT_FORMAT_RULES[format];

  // Auto-download bookkeeping: snapshot exports already completed when the
  // dialog opened so we only auto-download exports that complete during this
  // session, and never download the same one twice.
  const alreadyCompletedIds = useRef<Set<string>>(new Set());
  const autoDownloadedIds = useRef<Set<string>>(new Set());
  const snapshotTaken = useRef(false);

  useEffect(() => {
    if (!open) {
      snapshotTaken.current = false;
      alreadyCompletedIds.current = new Set();
      autoDownloadedIds.current = new Set();
    }
  }, [open]);

  // Snapshot pre-existing completed exports on first load after open, then
  // auto-download any that transition to completed while the dialog stays open.
  useEffect(() => {
    if (!open) return;
    if (!snapshotTaken.current) {
      if (exportsLoading) return; // wait for the first real fetch
      for (const ex of exports) {
        if (ex.status === "completed") alreadyCompletedIds.current.add(ex.id);
      }
      snapshotTaken.current = true;
      return;
    }
    for (const ex of exports) {
      if (
        ex.status === "completed" &&
        ex.downloadUrl &&
        !alreadyCompletedIds.current.has(ex.id) &&
        !autoDownloadedIds.current.has(ex.id)
      ) {
        autoDownloadedIds.current.add(ex.id);
        triggerDownload(ex.downloadUrl);
      }
    }
  }, [open, exports, exportsLoading]);

  // Whenever format changes, prune selection + force bundling into a legal state.
  useEffect(() => {
    setSelected((prev) => {
      const next = new Set<TopoLayerKey>();
      for (const l of prev) {
        const meta = TOPO_LAYERS.find((m) => m.name === l)!;
        if (meta.format === "raster" && rule.allowRaster) next.add(l);
        if (meta.format === "vector" && rule.allowVector) next.add(l);
      }
      if (next.size === 0) {
        for (const meta of TOPO_LAYERS) {
          if (meta.format === "raster" && rule.allowRaster) next.add(meta.name);
          if (meta.format === "vector" && rule.allowVector) next.add(meta.name);
        }
      }
      return next;
    });
    setBundling((prev) => {
      if (prev === "composite" && !rule.allowComposite) return "per-layer";
      if (prev === "per-layer" && !rule.allowPerLayer) return "composite";
      return prev;
    });
  }, [format, rule]);

  const validationResult = useMemo(() => {
    return validateExportRequest({
      format,
      bundling,
      layers: [...selected],
    });
  }, [format, bundling, selected]);

  const toggleLayer = (name: TopoLayerKey) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const canSubmit = !submitting && job !== null && validationResult.ok;

  async function handleExport() {
    if (!job) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch<{ id: string }>("/topo-exports", {
        method: "POST",
        body: {
          sourceJobIds: [job.jobId],
          layers: [...selected],
          format,
          bundling,
        },
      });
      refetchExports();
    } catch (err) {
      console.error(err);
      setError(messageFromError(err, "Couldn't queue the export."));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    setError(null);
    try {
      await deleteTopoExport(id);
      refetchExports();
    } catch (err) {
      console.error(err);
      setError(messageFromError(err, "Couldn't delete export."));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={submitting ? undefined : onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          backgroundColor: "var(--theme-primary)",
          color: "var(--theme-text-primary)",
        },
      }}
    >
      <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", pb: 1 }}>
        Export {job?.name ?? "Unnamed job"}
        <IconButton size="small" onClick={onClose} disabled={submitting} sx={{ color: "var(--theme-text-primary)" }}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers sx={{ borderColor: "rgba(255,255,255,0.1)" }}>
        {error && <ErrorBanner message={error} />}

        <Typography
          variant="caption"
          component="p"
          sx={{
            mb: 2,
            color: "var(--theme-text-muted)",
            opacity: 0.75,
          }}
        >
          Exported data is user-generated and derived from third-party sources;
          it may be inaccurate or outdated. Not a substitute for your own
          navigation, judgement, or rescue planning.
        </Typography>

        <Box sx={{ display: "flex", gap: 3, flexDirection: { xs: "column", sm: "row" }, mb: 2 }}>
          {/* Left column: Format + Bundling (bundling legality depends on format). */}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="caption" sx={{ color: "var(--theme-text-muted)" }}>Format</Typography>
            <RadioGroup value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
              {FORMAT_ORDER.map((f) => (
                <Tooltip key={f} title={EXPORT_FORMAT_RULES[f].description} placement="right" arrow>
                  <FormControlLabel
                    value={f}
                    control={<Radio size="small" />}
                    label={EXPORT_FORMAT_RULES[f].label}
                  />
                </Tooltip>
              ))}
            </RadioGroup>

            <Typography variant="caption" sx={{ color: "var(--theme-text-muted)", display: "block", mt: 1 }}>Bundling</Typography>
            <RadioGroup value={bundling} onChange={(e) => setBundling(e.target.value as ExportBundling)}>
              <Tooltip
                title={rule.allowPerLayer ? "" : `${rule.label} is inherently bundled.`}
                placement="right"
                arrow
              >
                <span>
                  <FormControlLabel
                    value="per-layer"
                    control={<Radio size="small" />}
                    label="One file per layer (ZIP)"
                    disabled={!rule.allowPerLayer}
                  />
                </span>
              </Tooltip>
              <Tooltip
                title={rule.allowComposite ? "" : `${rule.label} cannot be composited.`}
                placement="right"
                arrow
              >
                <span>
                  <FormControlLabel
                    value="composite"
                    control={<Radio size="small" />}
                    label="Single composite file"
                    disabled={!rule.allowComposite}
                  />
                </span>
              </Tooltip>
            </RadioGroup>
          </Box>

          {/* Right column: Layers. */}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="caption" sx={{ color: "var(--theme-text-muted)" }}>Layers</Typography>
            <FormControl component="fieldset">
              {TOPO_LAYERS.map((l) => {
                const eligible =
                  (l.format === "raster" && rule.allowRaster) ||
                  (l.format === "vector" && rule.allowVector);
                return (
                  <FormControlLabel
                    key={l.name}
                    control={
                      <Checkbox
                        size="small"
                        checked={selected.has(l.name)}
                        disabled={!eligible}
                        onChange={() => toggleLayer(l.name)}
                      />
                    }
                    label={`${l.label}${!eligible ? ` (n/a for ${rule.label})` : ""}`}
                  />
                );
              })}
            </FormControl>
          </Box>
        </Box>

        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <Typography variant="caption" sx={{ color: "var(--theme-text-muted)" }}>
            Active vector style applied
          </Typography>
          <Tooltip placement="top" arrow title={VECTOR_STYLE_TOOLTIP}>
            <InfoOutlinedIcon sx={{ fontSize: "0.95rem", color: "var(--theme-text-muted)", cursor: "help" }} />
          </Tooltip>
        </Box>

        {!validationResult.ok && (
          <Typography variant="caption" sx={{ color: "var(--theme-warning)", display: "block", mt: 1 }}>
            {validationResult.error}
          </Typography>
        )}

        <Box sx={{ mt: 3 }}>
          <Typography variant="caption" sx={{ color: "var(--theme-text-muted)", display: "block", mb: 0.5 }}>
            Recent exports
          </Typography>
          {exportsLoading && exports.length === 0 ? (
            <Typography variant="caption" sx={{ color: "var(--theme-text-muted)" }}>Loading…</Typography>
          ) : exports.length === 0 ? (
            <Typography variant="caption" sx={{ color: "var(--theme-text-muted)" }}>None yet.</Typography>
          ) : (
            <List dense disablePadding sx={{ maxHeight: 200, overflow: "auto" }}>
              {exports.map((ex) => {
                const isComplete = ex.status === "completed" && !!ex.downloadUrl;
                const isFailed = ex.status === "failed";
                const isInProgress = ex.status === "queued" || ex.status === "running";
                const detail = `${ex.layers.join(", ")} · ${ex.bundling}`;
                return (
                  <ListItem key={ex.id} disableGutters sx={{ gap: 1, py: 0.5 }}>
                    <Tooltip title={detail} placement="top" arrow>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1, flex: 1, minWidth: 0, cursor: "default" }}>
                        <strong>{ex.format.toUpperCase()}</strong>
                        <Chip
                          size="small"
                          label={ex.status}
                          color={isComplete ? "success" : isFailed ? "error" : "default"}
                        />
                        {ex.resultBytes !== null && (
                          <span style={{ opacity: 0.7, fontSize: "0.8em" }}>{formatBytes(ex.resultBytes)}</span>
                        )}
                        <span style={{ color: "var(--theme-text-muted)", fontSize: "0.8em" }}>
                          {timeAgo(ex.createdAt)}
                        </span>
                        {isFailed && ex.errorMessage && (
                          <Tooltip title={ex.errorMessage} placement="top" arrow>
                            <ErrorOutlineIcon sx={{ fontSize: "0.95rem", color: "var(--theme-warning)", cursor: "help" }} />
                          </Tooltip>
                        )}
                      </Box>
                    </Tooltip>
                    {isComplete && (
                      <Tooltip title="Download" placement="top" arrow>
                        <IconButton
                          size="small"
                          href={ex.downloadUrl!}
                          download
                          sx={{ color: "var(--theme-accent)" }}
                        >
                          <DownloadIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                    {!isInProgress && (
                      <Tooltip title="Delete" placement="top" arrow>
                        <span>
                          <IconButton
                            size="small"
                            onClick={() => handleDelete(ex.id)}
                            disabled={deletingId === ex.id}
                            sx={{ color: "var(--theme-text-muted)" }}
                          >
                            {deletingId === ex.id ? <CircularProgress size={16} /> : <DeleteOutlineIcon fontSize="small" />}
                          </IconButton>
                        </span>
                      </Tooltip>
                    )}
                  </ListItem>
                );
              })}
            </List>
          )}
        </Box>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} disabled={submitting} sx={{ color: "var(--theme-text-primary)" }}>
          Close
        </Button>
        <Button
          variant="contained"
          color="secondary"
          disabled={!canSubmit}
          onClick={handleExport}
        >
          {submitting ? <CircularProgress size={18} /> : "Start export"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
