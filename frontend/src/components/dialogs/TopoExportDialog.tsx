import { useMemo, useState } from "react";
import { useIsMobile } from "../../useIsMobile";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  IconButton,
  Typography,
  CircularProgress,
  Tooltip,
  Box,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import {
  validateExportRequest,
  type ExportSelection,
  type TopoLayerKey,
} from "@logjam/shared";
import { apiFetch } from "../../canyonUtils";
import { messageFromError } from "../../errors/messageFromError";
import { ErrorBanner } from "../feedback/ErrorBanner";
import { type CompletedTopoJob } from "../../topoLayerTypes";
import TopoExportControls from "./TopoExportControls";

interface Props {
  open: boolean;
  onClose: () => void;
  job: CompletedTopoJob | null;
  /** Called after an export is successfully queued, so the owner can refetch
   *  the shared exports list (rendered in the LiDAR panel accordion). */
  onExportQueued: () => void;
}

const INITIAL_SELECTION: ExportSelection = {
  format: "mbtiles",
  bundling: "composite",
  layers: ["hillshade", "vegetation", "slope", "contours", "features"],
};

const VECTOR_STYLE_TOOLTIP =
  "Each export freezes your vector style at the instant you press Start export. Editing the style afterwards does not change exports already queued — re-export to apply new styling.";

export default function TopoExportDialog({ open, onClose, job, onExportQueued }: Props) {
  const isMobile = useIsMobile();
  const [selection, setSelection] = useState<ExportSelection>(INITIAL_SELECTION);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only the layers this job actually produced can be exported. Absent layers
  // are hidden; the worker also drops empty layers as a backstop. TopoExportControls
  // reconciles the selection against this set.
  const jobLayerNames = useMemo(
    () => new Set<TopoLayerKey>((job?.layers ?? []).map((l) => l.name as TopoLayerKey)),
    [job],
  );

  const validationResult = useMemo(
    () => validateExportRequest(selection),
    [selection],
  );

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
          layers: selection.layers,
          format: selection.format,
          bundling: selection.bundling,
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
        <IconButton aria-label="Close dialog" size="small" onClick={onClose} disabled={submitting} sx={{ color: "var(--theme-text-primary)" }}>
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

        <TopoExportControls
          value={selection}
          onChange={setSelection}
          availableLayers={jobLayerNames}
        />

        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <Typography variant="caption" sx={{ color: "var(--theme-text-muted)" }}>
            Active vector style applied
          </Typography>
          <Tooltip placement="top" arrow title={VECTOR_STYLE_TOOLTIP}>
            <InfoOutlinedIcon sx={{ fontSize: "0.95rem", color: "var(--theme-text-muted)", cursor: "help" }} />
          </Tooltip>
        </Box>

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
