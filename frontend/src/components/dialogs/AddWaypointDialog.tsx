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
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import PlaceIcon from "@mui/icons-material/Place";
import {
  WAYPOINT_NAME_MAX_LENGTH,
  isValidLatitude,
  isValidLongitude,
  messageFromError,
} from "@logjam/shared";

import {
  fieldSx,
  dialogActionButtonSx,
  touchTargetSx,
} from "../../csvImport/dialogStyles";
import { ErrorBanner } from "../feedback/ErrorBanner";
import { useIsMobile } from "../../useIsMobile";

/**
 * Add a waypoint from coordinates.
 *
 * A dialog rather than a form inside the panel: this is an authoring step with
 * its own commit, and the panel is a browsing surface. It also frees the map —
 * "pick it on the map" needs the whole viewport, and the same trick CanyonDialog
 * uses applies here, with App hiding the dialog while the pick is armed
 * (`open={... && !pickingCoords}`). The component stays mounted throughout, so
 * the fields typed before the pick survive it and the picked coordinates land
 * in a form that still has its name in it.
 *
 * Editing an existing waypoint stays inline in the panel — that is a small
 * correction to something you are looking at, not an authoring step.
 */
export default function AddWaypointDialog({
  open,
  busy = false,
  onCreate,
  onPickCoords,
  onClose,
}: {
  open: boolean;
  busy?: boolean;
  /** Rejects on failure so the banner can report it without closing. */
  onCreate: (data: {
    name: string;
    latitude: number;
    longitude: number;
  }) => Promise<void>;
  onPickCoords: (onPicked: (lat: number, lng: number) => void) => void;
  onClose: () => void;
}): React.JSX.Element {
  const isMobile = useIsMobile();
  const [name, setName] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Only after a failed submit, so an untouched form isn't shouting at you.
  const [showFieldErrors, setShowFieldErrors] = useState(false);

  // Reseed on open — a cancelled add must not leave its coordinates behind for
  // the next one. Deliberately NOT keyed on `open` alone flipping false: the
  // map-pick flow closes this dialog and reopens it, and clearing then would
  // throw away the fields the pick was for.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setShowFieldErrors(false);
  }, [open]);

  const trimmedName = name.trim();
  const latValue = Number(latitude.trim());
  const lonValue = Number(longitude.trim());
  // Validated with the same predicates the API uses, so a typo is caught here
  // rather than as a failed request after the dialog has closed.
  const nameError = !trimmedName
    ? "Give it a name."
    : trimmedName.length > WAYPOINT_NAME_MAX_LENGTH
      ? `Must be at most ${WAYPOINT_NAME_MAX_LENGTH} characters`
      : null;
  const latError =
    !latitude.trim() || !isValidLatitude(latValue)
      ? "Must be between -90 and 90."
      : null;
  const lonError =
    !longitude.trim() || !isValidLongitude(lonValue)
      ? "Must be between -180 and 180."
      : null;
  const canSave = !nameError && !latError && !lonError && !saving && !busy;

  const reset = () => {
    setName("");
    setLatitude("");
    setLongitude("");
    setError(null);
    setShowFieldErrors(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const submit = () => {
    if (!canSave) {
      setShowFieldErrors(true);
      return;
    }
    setSaving(true);
    setError(null);
    onCreate({ name: trimmedName, latitude: latValue, longitude: lonValue })
      .then(() => {
        reset();
        onClose();
      })
      .catch((err: unknown) => {
        console.error(err);
        setError(messageFromError(err, "Couldn't save that waypoint."));
      })
      .finally(() => setSaving(false));
  };

  return (
    <Dialog
      fullScreen={isMobile}
      open={open}
      onClose={saving ? undefined : handleClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          backgroundColor: "var(--theme-primary)",
          color: "var(--theme-text-primary)",
        },
      }}
    >
      <DialogTitle sx={{ display: "flex", justifyContent: "space-between", pb: 1 }}>
        Add a waypoint
        <IconButton
          aria-label="Close dialog"
          onClick={handleClose}
          disabled={saving}
          sx={touchTargetSx}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers sx={{ borderColor: "rgba(255,255,255,0.1)" }}>
        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

        <TextField
          autoFocus
          fullWidth
          label="Name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
          }}
          error={showFieldErrors && nameError !== null}
          helperText={showFieldErrors ? (nameError ?? " ") : " "}
          sx={fieldSx}
        />

        <Box sx={{ display: "flex", gap: 1, flexDirection: isMobile ? "column" : "row" }}>
          <TextField
            fullWidth
            label="Latitude"
            value={latitude}
            inputMode="decimal"
            onChange={(event) => setLatitude(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit();
            }}
            error={showFieldErrors && latError !== null}
            helperText={showFieldErrors ? (latError ?? " ") : " "}
            sx={fieldSx}
          />
          <TextField
            fullWidth
            label="Longitude"
            value={longitude}
            inputMode="decimal"
            onChange={(event) => setLongitude(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit();
            }}
            error={showFieldErrors && lonError !== null}
            helperText={showFieldErrors ? (lonError ?? " ") : " "}
            sx={fieldSx}
          />
        </Box>

        {/* Two ways in, because the two cases differ: transcribing off a guide
            is typing, and "somewhere about there" is a click. App hides this
            dialog while the pick is armed, so the map is reachable. */}
        <Button
          variant="outlined"
          startIcon={<PlaceIcon />}
          onClick={() =>
            onPickCoords((lat, lng) => {
              setLatitude(lat.toFixed(5));
              setLongitude(lng.toFixed(5));
            })
          }
          disabled={saving}
          sx={{
            color: "var(--theme-accent)",
            borderColor: "var(--theme-accent)",
          }}
        >
          Pick it on the map
        </Button>
      </DialogContent>

      <DialogActions>
        <Button
          onClick={handleClose}
          disabled={saving}
          sx={{ ...dialogActionButtonSx, color: "var(--theme-text-primary)" }}
        >
          Cancel
        </Button>
        <Button
          variant="contained"
          color="secondary"
          onClick={submit}
          disabled={saving || busy}
          startIcon={saving ? <CircularProgress size={16} /> : undefined}
          sx={dialogActionButtonSx}
        >
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
