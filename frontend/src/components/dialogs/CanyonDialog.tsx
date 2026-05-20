import { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  MenuItem,
  Box,
  CircularProgress,
  IconButton,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import type { TCanyon } from "../../canyonUtils";
import { updateCanyon, createCanyon } from "../../canyonUtils";
import { messageFromError } from "../../errors/messageFromError";
import { ErrorBanner } from "../feedback/ErrorBanner";

const V_GRADES = [1, 2, 3, 4, 5, 6, 7] as const;
const A_GRADES = [1, 2, 3, 4, 5, 6, 7] as const;
const COMMITMENTS = [
  { value: 1, label: "I" },
  { value: 2, label: "II" },
  { value: 3, label: "III" },
  { value: 4, label: "IV" },
  { value: 5, label: "V" },
  { value: 6, label: "VI" },
] as const;
const QUALITY_GRADES = [1, 2, 3, 4, 5] as const;
const WETSUIT_GRADES = [1, 2, 3, 4, 5] as const;

const selectSx = {
  "& .MuiSelect-select": { color: "var(--theme-text-primary)" },
  "& .MuiSelect-icon": { color: "var(--theme-text-primary)" },
};

const selectProps = {
  MenuProps: {
    PaperProps: {
      sx: {
        backgroundColor: "var(--theme-primary)",
        color: "var(--theme-text-primary)",
        boxShadow: "0 8px 16px rgba(0, 0, 0, 0.3)",
      },
    },
  },
};

type Source = { label: string; url: string };

function CanyonDialog({
  canyon,
  open,
  onClose,
  onSaved,
  onPickCoords,
  onCancelPickCoords,
}: {
  canyon: TCanyon | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  onPickCoords: (onPicked: (lat: number, lng: number) => void) => void;
  onCancelPickCoords: () => void;
}) {
  const isEdit = canyon != null;

  const [name, setName] = useState("");
  const [altNames, setAltNames] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [numAbseils, setNumAbseils] = useState("");
  const [longestAbseil, setLongestAbseil] = useState("");
  const [notes, setNotes] = useState("");
  const [vGrade, setVGrade] = useState<number | "">("");
  const [aGrade, setAGrade] = useState<number | "">("");
  const [commitment, setCommitment] = useState<number | "">("");
  const [quality, setQuality] = useState<number | "">("");
  const [wetsuits, setWetsuits] = useState<number | "">("");
  const [hours, setHours] = useState("");
  const [sources, setSources] = useState<Source[]>([]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickingRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    if (pickingRef.current) {
      pickingRef.current = false;
      return;
    }
    if (canyon) {
      setName(canyon.name);
      setAltNames(canyon.altNames.join(", "));
      setLatitude(String(canyon.latitude));
      setLongitude(String(canyon.longitude));
      setNumAbseils(canyon.numAbseils != null ? String(canyon.numAbseils) : "");
      setLongestAbseil(
        canyon.longestAbseil != null ? String(canyon.longestAbseil) : "",
      );
      setNotes(canyon.notes ?? "");
      setVGrade(canyon.vGrade ?? "");
      setAGrade(canyon.aGrade ?? "");
      setCommitment(canyon.commitment ?? "");
      setQuality(canyon.quality ?? "");
      setWetsuits(canyon.wetsuits ?? "");
      setHours(canyon.hours != null ? String(canyon.hours) : "");
      setSources(
        (canyon.attributes.sources ?? []).map(([label, url]) => ({
          label,
          url,
        })),
      );
    } else {
      setName("");
      setAltNames("");
      setLatitude("");
      setLongitude("");
      setNumAbseils("");
      setLongestAbseil("");
      setNotes("");
      setVGrade("");
      setAGrade("");
      setCommitment("");
      setQuality("");
      setWetsuits("");
      setHours("");
      setSources([]);
    }
    setError(null);
  }, [open, canyon]);

  function handlePickCoords() {
    pickingRef.current = true;
    onPickCoords((lat, lng) => {
      setLatitude(String(lat));
      setLongitude(String(lng));
    });
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const parsedLat = parseFloat(latitude);
      const parsedLng = parseFloat(longitude);
      if (!name.trim()) {
        setError("Name is required");
        setSaving(false);
        return;
      }
      if (!latitude || !longitude || isNaN(parsedLat) || isNaN(parsedLng)) {
        setError("Valid coordinates are required");
        setSaving(false);
        return;
      }

      const cleanSources: [string, string][] = sources
        .filter((s) => s.label.trim())
        .map((s) => [s.label.trim(), s.url.trim()]);

      const data = {
        name: name.trim(),
        altNames: altNames
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        latitude: parsedLat,
        longitude: parsedLng,
        numAbseils: numAbseils ? parseInt(numAbseils) : null,
        longestAbseil: longestAbseil ? parseFloat(longestAbseil) : null,
        vGrade: vGrade !== "" ? (vGrade as number) : null,
        aGrade: aGrade !== "" ? (aGrade as number) : null,
        commitment: commitment !== "" ? (commitment as number) : null,
        quality: quality !== "" ? (quality as number) : null,
        wetsuits: wetsuits !== "" ? (wetsuits as number) : null,
        hours: hours ? parseFloat(hours) : null,
        notes: notes || null,
        attributes: {
          ...canyon?.attributes,
          sources: cleanSources.length > 0 ? cleanSources : undefined,
        },
      };

      if (isEdit) {
        await updateCanyon(canyon.id, data);
      } else {
        await createCanyon(data);
      }
      onSaved();
      onClose();
    } catch (err) {
      console.error(err);
      setError(messageFromError(err, "Couldn't save canyon. Please try again."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={saving ? undefined : onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          backgroundColor: "var(--theme-primary)",
          color: "var(--theme-text-primary)",
          "& .MuiInputBase-input": { color: "var(--theme-text-primary)" },
          "& .MuiInputBase-inputMultiline": { color: "var(--theme-text-primary)" },
          "& .MuiOutlinedInput-notchedOutline": { borderColor: "var(--theme-accent)" },
          "& .MuiOutlinedInput-root:hover .MuiOutlinedInput-notchedOutline": { borderColor: "var(--theme-accent)" },
          "& .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline": { borderColor: "var(--theme-accent)" },
          "& .MuiInputLabel-root": { color: "var(--theme-text-muted)" },
          "& .MuiInputLabel-root.Mui-focused": { color: "var(--theme-accent)" },
        },
      }}
    >
      <DialogTitle
        sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", pb: 1 }}
      >
        {isEdit ? "Edit Canyon" : "Add Canyon"}
        <IconButton
          size="small"
          onClick={saving ? undefined : onClose}
          disabled={saving}
          sx={{ color: "var(--theme-text-primary)" }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ borderColor: "rgba(255,255,255,0.1)" }}>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}>
          <TextField
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            size="small"
          />
          <TextField
            label="Alternative Names (comma-separated)"
            value={altNames}
            onChange={(e) => setAltNames(e.target.value)}
            size="small"
          />
          <Box sx={{ display: "flex", gap: 2, alignItems: "center" }}>
            <TextField
              label="Latitude"
              value={latitude}
              onChange={(e) => setLatitude(e.target.value)}
              type="number"
              size="small"
              fullWidth
            />
            <TextField
              label="Longitude"
              value={longitude}
              onChange={(e) => setLongitude(e.target.value)}
              type="number"
              size="small"
              fullWidth
            />
            <Button
              variant="contained"
              color="secondary"
              sx={{
                whiteSpace: "nowrap",
                minWidth: "auto",
                height: "40px",
              }}
              onClick={handlePickCoords}
            >
              📍 Select on Map
            </Button>
          </Box>
          <Box sx={{ display: "flex", gap: 2 }}>
            <TextField
              label="V Grade"
              value={vGrade}
              onChange={(e) =>
                setVGrade(e.target.value === "" ? "" : Number(e.target.value))
              }
              select
              size="small"
              fullWidth
              sx={selectSx}
              SelectProps={selectProps}
            >
              <MenuItem value="">None</MenuItem>
              {V_GRADES.map((v) => (
                <MenuItem key={v} value={v}>
                  v{v}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="A Grade"
              value={aGrade}
              onChange={(e) =>
                setAGrade(e.target.value === "" ? "" : Number(e.target.value))
              }
              select
              size="small"
              fullWidth
              sx={selectSx}
              SelectProps={selectProps}
            >
              <MenuItem value="">None</MenuItem>
              {A_GRADES.map((a) => (
                <MenuItem key={a} value={a}>
                  a{a}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Commitment"
              value={commitment}
              onChange={(e) =>
                setCommitment(
                  e.target.value === "" ? "" : Number(e.target.value),
                )
              }
              select
              size="small"
              fullWidth
              sx={selectSx}
              SelectProps={selectProps}
            >
              <MenuItem value="">None</MenuItem>
              {COMMITMENTS.map((c) => (
                <MenuItem key={c.value} value={c.value}>
                  {c.label}
                </MenuItem>
              ))}
            </TextField>
          </Box>
          <Box sx={{ display: "flex", gap: 2 }}>
            <TextField
              label="Quality (1-5)"
              value={quality}
              onChange={(e) =>
                setQuality(e.target.value === "" ? "" : Number(e.target.value))
              }
              select
              size="small"
              fullWidth
              sx={selectSx}
              SelectProps={selectProps}
            >
              <MenuItem value="">None</MenuItem>
              {QUALITY_GRADES.map((q) => (
                <MenuItem key={q} value={q}>
                  {q}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Wetsuits (1-5)"
              value={wetsuits}
              onChange={(e) =>
                setWetsuits(e.target.value === "" ? "" : Number(e.target.value))
              }
              select
              size="small"
              fullWidth
              sx={selectSx}
              SelectProps={selectProps}
            >
              <MenuItem value="">None</MenuItem>
              {WETSUIT_GRADES.map((w) => (
                <MenuItem key={w} value={w}>
                  {w}
                </MenuItem>
              ))}
            </TextField>
          </Box>
          <Box sx={{ display: "flex", gap: 2 }}>
            <TextField
              label="Pitches"
              value={numAbseils}
              onChange={(e) => setNumAbseils(e.target.value)}
              type="number"
              size="small"
              fullWidth
            />
            <TextField
              label="Longest Pitch (m)"
              value={longestAbseil}
              onChange={(e) => setLongestAbseil(e.target.value)}
              type="number"
              size="small"
              fullWidth
            />
            <TextField
              label="Hours"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              type="number"
              size="small"
              fullWidth
            />
          </Box>
          <TextField
            label="Notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            multiline
            minRows={2}
            size="small"
          />

          <Box>
            <Typography variant="body2" sx={{ mb: 0.5 }}>
              Sources
            </Typography>
            {sources.map((source, i) => (
              <Box
                key={i}
                sx={{ display: "flex", gap: 1, mb: 1, alignItems: "center" }}
              >
                <TextField
                  label="Label"
                  value={source.label}
                  onChange={(e) => {
                    const next = [...sources];
                    next[i] = { ...next[i], label: e.target.value };
                    setSources(next);
                  }}
                  size="small"
                  fullWidth
                />
                <TextField
                  label="URL (optional)"
                  value={source.url}
                  onChange={(e) => {
                    const next = [...sources];
                    next[i] = { ...next[i], url: e.target.value };
                    setSources(next);
                  }}
                  size="small"
                  fullWidth
                />
                <IconButton
                  size="small"
                  onClick={() => setSources(sources.filter((_, j) => j !== i))}
                  sx={{
                    color: "var(--theme-warning)",
                    flexShrink: 0,
                    width: 32,
                    height: 32,
                  }}
                >
                  ✕
                </IconButton>
              </Box>
            ))}
            <Button
              variant="outlined"
              sx={{
                height: "40px",
                color: "var(--theme-text-primary)",
                borderColor: "var(--theme-accent)",
                "&:hover": {
                  backgroundColor:
                    "color-mix(in srgb, var(--theme-accent) 12%, transparent)",
                },
              }}
              onClick={() => setSources([...sources, { label: "", url: "" }])}
            >
              + Add Source
            </Button>
          </Box>

          {error && <ErrorBanner message={error} />}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button
          onClick={() => {
            onCancelPickCoords();
            onClose();
          }}
          disabled={saving}
          sx={{ color: "var(--theme-text-primary)" }}
        >
          Cancel
        </Button>
        <Button
          variant="contained"
          color="secondary"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? <CircularProgress size={20} /> : "Save"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default CanyonDialog;
