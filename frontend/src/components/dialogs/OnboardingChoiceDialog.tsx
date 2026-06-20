import { useState } from "react";
import { useIsMobile } from "../../useIsMobile";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  IconButton,
  Typography,
  Box,
  CircularProgress,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import { importFromRopeWiki } from "../../canyonUtils";
import { messageFromError } from "../../errors/messageFromError";
import { ErrorBanner } from "../feedback/ErrorBanner";

// First-login choice screen for an empty account (plan §7e). Non-forced: the
// user picks how to get data in, or starts empty. Nothing auto-runs.
//
// The RopeWiki load runs inline here (no separate dialog) and leaves the user in
// this welcome hub so they can also import files or start empty afterwards.
function OnboardingChoiceDialog({
  open,
  onImportFiles,
  onStartEmpty,
  onLoaded,
}: {
  open: boolean;
  onImportFiles: () => void;
  onStartEmpty: () => void;
  onLoaded: () => void;
}) {
  const isMobile = useIsMobile();

  const [ropewikiState, setRopewikiState] = useState<
    "idle" | "loading" | "done" | "error"
  >("idle");
  const [loadedSummary, setLoadedSummary] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  async function handleLoadRopeWiki() {
    setRopewikiState("loading");
    setError(null);
    try {
      const res = await importFromRopeWiki();
      onLoaded();
      const skipped = res.skipped + res.errors.length;
      setLoadedSummary(
        `${res.imported} canyon${res.imported !== 1 ? "s" : ""} loaded` +
          (skipped > 0 ? `, ${skipped} skipped` : ""),
      );
      setRopewikiState("done");
    } catch (err) {
      console.error(err);
      setError(
        messageFromError(
          err,
          "Couldn't load the RopeWiki database. You can try again later from the sidebar.",
        ),
      );
      setRopewikiState("error");
    }
  }

  const loading = ropewikiState === "loading";

  return (
    <Dialog
      fullScreen={isMobile}
      open={open}
      onClose={loading ? undefined : onStartEmpty}
      maxWidth="sm"
      fullWidth
      disableAutoFocus
      PaperProps={{
        sx: {
          backgroundColor: "var(--theme-primary)",
          color: "var(--theme-text-primary)",
        },
      }}
    >
      <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", pb: 1 }}>
        Welcome to Logjam
        <IconButton
          aria-label="Close dialog"
          size="small"
          onClick={onStartEmpty}
          disabled={loading}
          sx={{ color: "var(--theme-text-primary)" }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ borderColor: "rgba(255,255,255,0.1)" }}>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
          <Typography variant="body2" sx={{ color: "var(--theme-text-muted)" }}>
            How would you like to start? You can do any of these later, too.
          </Typography>

          {ropewikiState === "done" ? (
            <Button
              variant="contained"
              color="secondary"
              disabled
              startIcon={<CheckCircleIcon />}
              sx={{ textTransform: "none", justifyContent: "flex-start" }}
            >
              NSW canyon database (RopeWiki) loaded
            </Button>
          ) : (
            <Button
              variant="contained"
              color="secondary"
              onClick={handleLoadRopeWiki}
              disabled={loading}
              startIcon={loading ? <CircularProgress size={18} color="inherit" /> : undefined}
              sx={{ textTransform: "none", justifyContent: "flex-start" }}
            >
              {loading ? "Importing…" : "Load the NSW canyon database (RopeWiki) — recommended"}
            </Button>
          )}

          {ropewikiState === "done" && (
            <Typography variant="caption" sx={{ color: "var(--theme-text-muted)", pl: 0.5 }}>
              {loadedSummary}
            </Typography>
          )}

          {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

          <Button
            variant="outlined"
            onClick={onImportFiles}
            disabled={loading}
            sx={{
              textTransform: "none",
              justifyContent: "flex-start",
              borderColor: "var(--theme-accent)",
              color: "var(--theme-accent)",
            }}
          >
            Import my own files (canyons or logbook)
          </Button>
          <Typography variant="caption" sx={{ color: "var(--theme-text-muted)", pl: 0.5 }}>
            A canyon list needs name, latitude and longitude (grades and notes are
            optional). A logbook needs a canyon name and a date (notes optional).
          </Typography>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onStartEmpty} disabled={loading} sx={{ color: "var(--theme-text-primary)" }}>
          {ropewikiState === "done" ? "Done" : "Start empty"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default OnboardingChoiceDialog;
