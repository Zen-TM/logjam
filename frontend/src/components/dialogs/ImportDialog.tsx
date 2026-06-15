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
  CircularProgress,
  Box,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { importFromRopeWiki, type ImportResult } from "../../canyonUtils";
import { messageFromError } from "../../errors/messageFromError";
import { ErrorBanner } from "../feedback/ErrorBanner";
import RopeWikiReviewDialog from "./RopeWikiReviewDialog";

function ImportDialog({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}) {
  const isMobile = useIsMobile();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);

  async function handleImport() {
    setLoading(true);
    setError(null);
    try {
      const res = await importFromRopeWiki();
      setResult(res);
      onImported();
    } catch (err) {
      console.error(err);
      setError(messageFromError(err, "Import failed. You can try again later from the sidebar."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog
      fullScreen={isMobile}
      open={open}
      onClose={loading ? undefined : onClose}
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
        Welcome to Logjam
        <IconButton
          size="small"
          onClick={loading ? undefined : onClose}
          disabled={loading}
          sx={{ color: "var(--theme-text-primary)" }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ borderColor: "rgba(255,255,255,0.1)" }}>
        {!result && !loading && !error && (
          <Typography>
            Would you like to import NSW canyons from RopeWiki to get started?
            This will add ~200 published canyons to your collection. You can
            always refresh from RopeWiki later without losing your edits.
          </Typography>
        )}
        {loading && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 2, py: 2 }}>
            <CircularProgress size={24} />
            <Typography>Importing canyons from RopeWiki...</Typography>
          </Box>
        )}
        {error && <ErrorBanner message={error} />}
        {result && (
          <Typography>
            Imported {result.imported} canyon{result.imported !== 1 ? "s" : ""}
            {result.autoLinked > 0 &&
              `, linked ${result.autoLinked} to existing canyon${result.autoLinked !== 1 ? "s" : ""}`}
            {result.skipped > 0 && ` (${result.skipped} already existed)`}.
            {result.review.length > 0 &&
              ` ${result.review.length} possible duplicate${result.review.length !== 1 ? "s" : ""} need review.`}
            {result.errors.length > 0 &&
              ` ${result.errors.length} row${result.errors.length !== 1 ? "s" : ""} could not be parsed.`}
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        {!result && !loading && (
          <>
            <Button onClick={onClose} sx={{ color: "var(--theme-text-primary)" }}>Skip for now</Button>
            <Button
              variant="contained"
              color="secondary"
              onClick={handleImport}
            >
              Import canyons
            </Button>
          </>
        )}
        {(result || error) && (
          <>
            {result && result.review.length > 0 && (
              <Button
                variant="outlined"
                color="secondary"
                onClick={() => setReviewOpen(true)}
              >
                Review {result.review.length}
              </Button>
            )}
            <Button variant="contained" color="secondary" onClick={onClose}>
              Close
            </Button>
          </>
        )}
      </DialogActions>
      {result && (
        <RopeWikiReviewDialog
          open={reviewOpen}
          review={result.review}
          onClose={() => setReviewOpen(false)}
          onApplied={() => {
            setResult({ ...result, review: [] });
            onImported();
          }}
        />
      )}
    </Dialog>
  );
}

export default ImportDialog;
