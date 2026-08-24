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
  Box,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { ROUTE_NAME_MAX_LENGTH, TRACK_COLORS } from "@logjam/shared";
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
  initialColor,
  busy = false,
  onSave,
  onClose,
}: {
  open: boolean;
  initialName: string;
  initialColor?: string;
  busy?: boolean;
  onSave: (name: string, color?: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  const [name, setName] = useState(initialName);
  const [color, setColor] = useState<string | undefined>(initialColor);

  // Reseed whenever the dialog reopens — editing a different route must not
  // inherit the previous one's name.
  useEffect(() => {
    if (open) {
      setName(initialName);
      setColor(initialColor);
    }
  }, [open, initialName, initialColor]);

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
            if (e.key === "Enter" && canSave) onSave(trimmed, color);
          }}
          error={tooLong}
          helperText={
            tooLong ? `Must be at most ${ROUTE_NAME_MAX_LENGTH} characters` : " "
          }
          sx={fieldSx}
        />
        <Box sx={{ mt: 2, display: "flex", flexDirection: "column", gap: 1 }}>
          <Typography
            variant="caption"
            sx={{
              color: "var(--theme-text-muted, rgba(255, 255, 255, 0.7))",
              fontSize: "0.85em",
            }}
          >
            Route colour
          </Typography>
          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
            {TRACK_COLORS.map((c) => {
              const isSelected = color === c;
              return (
                <Box
                  key={c}
                  component="button"
                  type="button"
                  aria-label={`Colour ${c}`}
                  aria-pressed={isSelected}
                  onClick={() => setColor(c)}
                  sx={{
                    width: 32,
                    height: 32,
                    borderRadius: "6px",
                    backgroundColor: c,
                    border: isSelected ? "2px solid #ffffff" : "2px solid transparent",
                    cursor: "pointer",
                    p: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    outline: "none",
                    "&:hover": {
                      opacity: 0.9,
                    },
                  }}
                >
                  {isSelected && (
                    <span
                      style={{
                        color: "#ffffff",
                        fontWeight: "bold",
                        textShadow: "0 0 2px #000",
                        lineHeight: 1,
                      }}
                    >
                      ✓
                    </span>
                  )}
                </Box>
              );
            })}
          </Box>
        </Box>
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
          onClick={() => onSave(trimmed, color)}
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
