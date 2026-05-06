import { useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  IconButton,
  TextField,
  Typography,
  CircularProgress,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { deleteUser } from "aws-amplify/auth";
import { deleteAccount } from "../../canyonUtils";

const inputSx = {
  "& .MuiInputBase-input": { color: "var(--theme-text-primary)" },
  "& .MuiInputLabel-root": { color: "var(--theme-text-muted)" },
  "& .MuiInputLabel-root.Mui-focused": { color: "var(--theme-accent)" },
  "& .MuiOutlinedInput-notchedOutline": { borderColor: "rgba(255,255,255,0.3)" },
  "& .MuiOutlinedInput-root:hover .MuiOutlinedInput-notchedOutline": {
    borderColor: "rgba(255,255,255,0.5)",
  },
  "& .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline": {
    borderColor: "var(--theme-warning)",
  },
};

function DeleteAccountDialog({
  open,
  onClose,
  username,
  onDeleted,
}: {
  open: boolean;
  onClose: () => void;
  username: string;
  onDeleted: () => void;
}) {
  const [confirmInput, setConfirmInput] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const expectedPhrase = `delete ${username}`;
  const inputMatches = confirmInput.trim().toLowerCase() === expectedPhrase.toLowerCase();

  async function handleDelete() {
    if (!inputMatches || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteAccount();
      await deleteUser();
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete account");
      setDeleting(false);
    }
  }

  function handleClose() {
    if (deleting) return;
    setConfirmInput("");
    setError(null);
    onClose();
  }

  return (
    <Dialog
      open={open}
      maxWidth="sm"
      fullWidth
      onClose={handleClose}
      PaperProps={{
        sx: { backgroundColor: "var(--theme-primary)", color: "var(--theme-text-primary)" },
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
        Delete account
        <IconButton
          size="small"
          onClick={handleClose}
          disabled={deleting}
          sx={{ color: "var(--theme-text-primary)" }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ borderColor: "rgba(255,255,255,0.1)", display: "flex", flexDirection: "column", gap: 2 }}>
        <Typography sx={{ color: "var(--theme-text-primary)", fontSize: "var(--text-sm)" }}>
          This will permanently delete your account and all associated data — canyons, trip logs,
          media, and settings. This action cannot be undone.
        </Typography>
        <Typography sx={{ color: "var(--theme-text-muted)", fontSize: "var(--text-sm)" }}>
          Type <strong style={{ color: "var(--theme-text-primary)" }}>{expectedPhrase}</strong> to
          confirm.
        </Typography>
        <TextField
          size="small"
          fullWidth
          placeholder={expectedPhrase}
          value={confirmInput}
          onChange={(e) => setConfirmInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleDelete(); }}
          disabled={deleting}
          autoFocus
          sx={inputSx}
        />
        {error && (
          <Typography
            sx={{
              fontSize: "var(--text-xs)",
              color: "var(--theme-text-primary)",
              background: "color-mix(in srgb, var(--theme-warning) 25%, transparent)",
              border: "1px solid color-mix(in srgb, var(--theme-warning) 55%, transparent)",
              borderRadius: "var(--radius-sm)",
              padding: "8px 10px",
            }}
          >
            {error}
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button
          onClick={handleClose}
          disabled={deleting}
          sx={{ color: "var(--theme-text-primary)" }}
        >
          Cancel
        </Button>
        <Button
          variant="contained"
          color="error"
          disabled={!inputMatches || deleting}
          onClick={handleDelete}
          startIcon={deleting ? <CircularProgress size={14} color="inherit" /> : undefined}
        >
          {deleting ? "Deleting…" : "Delete account"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default DeleteAccountDialog;
