import { useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  CircularProgress,
  Box,
} from "@mui/material";
import { importFromRopeWiki, type ImportResult } from "../../canyonUtils";

function ImportDialog({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleImport() {
    setLoading(true);
    setError(null);
    try {
      const res = await importFromRopeWiki();
      setResult(res);
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={loading ? undefined : onClose}
      PaperProps={{
        sx: {
          backgroundColor: "var(--theme-primary)",
          color: "var(--theme-text-primary)",
        },
      }}
    >
      <DialogTitle>Welcome to Logjam</DialogTitle>
      <DialogContent>
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
        {error && (
          <Typography color="error">
            {error}. You can try again later from the sidebar.
          </Typography>
        )}
        {result && (
          <Typography>
            Imported {result.imported} canyon{result.imported !== 1 ? "s" : ""}
            {result.skipped > 0 && ` (${result.skipped} already existed)`}.
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
          <Button variant="contained" color="secondary" onClick={onClose}>
            Close
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

export default ImportDialog;
