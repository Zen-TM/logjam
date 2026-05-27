import { useEffect, useMemo, useState } from "react";
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
  ListItemText,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import {
  EXPORT_FORMAT_RULES,
  validateExportRequest,
  type ExportFormat,
  type ExportBundling,
  type TopoLayerKey,
} from "@logjam/shared";
import { apiFetch, useTopoExports } from "../../canyonUtils";
import { messageFromError } from "../../errors/messageFromError";
import { ErrorBanner } from "../feedback/ErrorBanner";
import { TOPO_LAYERS, type CompletedTopoJob } from "../../topoLayerTypes";

interface Props {
  open: boolean;
  onClose: () => void;
  job: CompletedTopoJob | null;
}

const ALL_LAYER_NAMES = TOPO_LAYERS.map((l) => l.name) as TopoLayerKey[];

const FORMAT_ORDER: ExportFormat[] = ["mbtiles", "geotiff", "gpkg", "geojson", "gpx"];

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

export default function TopoExportDialog({ open, onClose, job }: Props) {
  const [format, setFormat] = useState<ExportFormat>("mbtiles");
  const [bundling, setBundling] = useState<ExportBundling>("composite");
  const [selected, setSelected] = useState<Set<TopoLayerKey>>(() => new Set(ALL_LAYER_NAMES));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Poll while dialog is open so users see status flip from queued → completed.
  const { exports, loading: exportsLoading, refetch: refetchExports } = useTopoExports(open, open ? 5000 : 0);

  const rule = EXPORT_FORMAT_RULES[format];

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
        Export topo job
        <IconButton size="small" onClick={onClose} disabled={submitting} sx={{ color: "var(--theme-text-primary)" }}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers sx={{ borderColor: "rgba(255,255,255,0.1)" }}>
        {job && (
          <Typography variant="body2" sx={{ mb: 2, color: "var(--theme-text-muted)" }}>
            {job.name ?? "Unnamed job"}
          </Typography>
        )}
        {error && <ErrorBanner message={error} />}

        <Box sx={{ mb: 2 }}>
          <Typography variant="caption" sx={{ color: "var(--theme-text-muted)" }}>Format</Typography>
          <RadioGroup row value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
            {FORMAT_ORDER.map((f) => (
              <Tooltip key={f} title={EXPORT_FORMAT_RULES[f].description} placement="top" arrow>
                <FormControlLabel
                  value={f}
                  control={<Radio size="small" />}
                  label={EXPORT_FORMAT_RULES[f].label}
                />
              </Tooltip>
            ))}
          </RadioGroup>
        </Box>

        <Box sx={{ mb: 2 }}>
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

        <Box sx={{ mb: 1 }}>
          <Typography variant="caption" sx={{ color: "var(--theme-text-muted)" }}>Bundling</Typography>
          <RadioGroup row value={bundling} onChange={(e) => setBundling(e.target.value as ExportBundling)}>
            <Tooltip
              title={rule.allowPerLayer ? "" : `${rule.label} is inherently bundled.`}
              placement="top"
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
              placement="top"
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

        <Typography variant="caption" sx={{ color: "var(--theme-text-muted)", display: "block", mt: 1 }}>
          Vector style: <strong>Active style</strong> — composites and styled exports use your live vector style at the moment of export submission. Edit it in the LiDAR Topos panel.
        </Typography>

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
                const isComplete = ex.status === "completed" && ex.downloadUrl;
                const isFailed = ex.status === "failed";
                return (
                  <ListItem
                    key={ex.id}
                    disableGutters
                    secondaryAction={
                      isComplete ? (
                        <Button
                          size="small"
                          href={ex.downloadUrl!}
                          download
                          sx={{ color: "var(--theme-accent)" }}
                        >
                          Download
                        </Button>
                      ) : null
                    }
                  >
                    <ListItemText
                      primary={
                        <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                          <strong>{ex.format.toUpperCase()}</strong>
                          <Chip
                            size="small"
                            label={ex.status}
                            color={isComplete ? "success" : isFailed ? "error" : "default"}
                          />
                          <span style={{ opacity: 0.7, fontSize: "0.8em" }}>
                            {ex.layers.join(", ")} · {ex.bundling}
                          </span>
                        </Box>
                      }
                      secondary={
                        <span style={{ color: "var(--theme-text-muted)", fontSize: "0.75em" }}>
                          {timeAgo(ex.createdAt)}
                          {ex.resultBytes !== null && ` · ${formatBytes(ex.resultBytes)}`}
                          {isFailed && ex.errorMessage && ` · ${ex.errorMessage}`}
                        </span>
                      }
                    />
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
