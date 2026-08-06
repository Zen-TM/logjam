import { useEffect, useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  IconButton,
  CircularProgress,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { ROUTE_NAME_MAX_LENGTH } from "@logjam/shared";
import {
  fieldSx,
  dialogActionButtonSx,
  touchTargetSx,
} from "../../csvImport/dialogStyles";

/**
 * Names a route on save.
 *
 * Deliberately a dialog, not a window.prompt: the rest of the app authors
 * through dialogs, and a native prompt carries neither the theme nor the
 * length validation that the API enforces.
 */
export default function RouteNameDialog({
  open,
  initialName,
  busy = false,
  onSave,
  onClose,
}: {
  open: boolean;
  initialName: string;
  busy?: boolean;
  onSave: (name: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  const [name, setName] = useState(initialName);

  // Reseed whenever the dialog reopens — editing a different route must not
  // inherit the previous one's name.
  useEffect(() => {
    if (open) setName(initialName);
  }, [open, initialName]);

  const trimmed = name.trim();
  const tooLong = trimmed.length > ROUTE_NAME_MAX_LENGTH;
  const canSave = trimmed.length > 0 && !tooLong && !busy;

  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          backgroundColor: "var(--theme-primary)",
          color: "var(--theme-text-primary)",
        },
      }}
    >
      <DialogTitle
        sx={{ display: "flex", justifyContent: "space-between", pb: 1 }}
      >
        Name this route
        <IconButton
          aria-label="Close dialog"
          onClick={onClose}
          disabled={busy}
          sx={touchTargetSx}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ borderColor: "rgba(255,255,255,0.1)" }}>
        <TextField
          autoFocus
          fullWidth
          label="Route name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canSave) onSave(trimmed);
          }}
          error={tooLong}
          helperText={
            tooLong ? `Must be at most ${ROUTE_NAME_MAX_LENGTH} characters` : " "
          }
          sx={fieldSx}
        />
      </DialogContent>
      <DialogActions>
        <Button
          onClick={onClose}
          disabled={busy}
          sx={{ ...dialogActionButtonSx, color: "var(--theme-text-primary)" }}
        >
          Cancel
        </Button>
        <Button
          variant="contained"
          color="secondary"
          onClick={() => onSave(trimmed)}
          disabled={!canSave}
          startIcon={busy ? <CircularProgress size={16} /> : undefined}
          sx={dialogActionButtonSx}
        >
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
