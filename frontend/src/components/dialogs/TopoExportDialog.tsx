import { useEffect, useMemo, useState } from "react";
import { useIsMobile } from "../../useIsMobile";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  IconButton,
  Typography,
  FormGroup,
  FormControlLabel,
  Checkbox,
  RadioGroup,
  Radio,
  CircularProgress,
  Tooltip,
  Box,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import {
  EXPORT_FORMAT_RULES,
  validateExportRequest,
  type ExportFormat,
  type ExportBundling,
  type TopoLayerKey,
} from "@logjam/shared";
import { apiFetch } from "../../canyonUtils";
import { messageFromError } from "../../errors/messageFromError";
import { ErrorBanner } from "../feedback/ErrorBanner";
import { TOPO_LAYERS, type CompletedTopoJob } from "../../topoLayerTypes";

interface Props {
  open: boolean;
  onClose: () => void;
  job: CompletedTopoJob | null;
  /** Called after an export is successfully queued, so the owner can refetch
   *  the shared exports list (rendered in the LiDAR panel accordion). */
  onExportQueued: () => void;
}

const FORMAT_ORDER: ExportFormat[] = ["mbtiles", "geotiff", "gpkg", "geojson", "gpx"];

const INITIAL_FORMAT: ExportFormat = "mbtiles";

const VECTOR_STYLE_TOOLTIP =
  "Each export freezes your vector style at the instant you press Start export. Editing the style afterwards does not change exports already queued — re-export to apply new styling.";

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

export default function TopoExportDialog({ open, onClose, job, onExportQueued }: Props) {
  const isMobile = useIsMobile();
  const [format, setFormat] = useState<ExportFormat>(INITIAL_FORMAT);
  const [bundling, setBundling] = useState<ExportBundling>("composite");
  const [selected, setSelected] = useState<Set<TopoLayerKey>>(() => layersForFormat(INITIAL_FORMAT));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rule = EXPORT_FORMAT_RULES[format];

  // Only the layers this job actually produced can be exported. Absent layers
  // are hidden; the worker also drops empty layers as a backstop.
  const jobLayerNames = useMemo(
    () => new Set<TopoLayerKey>((job?.layers ?? []).map((l) => l.name as TopoLayerKey)),
    [job],
  );

  // Whenever format or the job changes, prune selection to layers that are both
  // eligible for the format and present in the job; force bundling into a legal
  // state.
  useEffect(() => {
    const eligibleAndPresent = (name: TopoLayerKey): boolean => {
      if (!jobLayerNames.has(name)) return false;
      const meta = TOPO_LAYERS.find((m) => m.name === name)!;
      return (
        (meta.format === "raster" && rule.allowRaster) ||
        (meta.format === "vector" && rule.allowVector)
      );
    };
    setSelected((prev) => {
      const next = new Set<TopoLayerKey>();
      for (const l of prev) {
        if (eligibleAndPresent(l)) next.add(l);
      }
      if (next.size === 0) {
        for (const meta of TOPO_LAYERS) {
          if (eligibleAndPresent(meta.name)) next.add(meta.name);
        }
      }
      return next;
    });
    setBundling((prev) => {
      if (prev === "composite" && !rule.allowComposite) return "per-layer";
      if (prev === "per-layer" && !rule.allowPerLayer) return "composite";
      return prev;
    });
  }, [format, rule, jobLayerNames]);

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
      onExportQueued();
      onClose();
    } catch (err) {
      console.error(err);
      setError(messageFromError(err, "Couldn't queue the export."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      fullScreen={isMobile}
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
            <FormGroup>
              {TOPO_LAYERS.filter((l) => jobLayerNames.has(l.name)).map((l) => {
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
            </FormGroup>
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

        <Typography variant="caption" sx={{ color: "var(--theme-text-muted)", display: "block", mt: 2 }}>
          Queued exports appear in the Exports section of the LiDAR panel and
          download automatically when ready.
        </Typography>
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
