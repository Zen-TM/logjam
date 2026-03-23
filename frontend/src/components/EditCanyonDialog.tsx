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
import type { TCanyon, TCanyonAttributes } from "../canyonUtils";
import { updateCanyon } from "../canyonUtils";

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

// Shared sx for select TextFields so the selected value text is white
const selectSx = {
  "& .MuiSelect-select": { color: "var(--content-color)" },
  "& .MuiSelect-icon": { color: "var(--content-color)" },
};

type Source = { label: string; url: string };

function EditCanyonDialog({
  canyon,
  open,
  onClose,
  onSaved,
  onPickCoords,
  onCancelPickCoords,
}: {
  canyon: TCanyon;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  onPickCoords: (onPicked: (lat: number, lng: number) => void) => void;
  onCancelPickCoords: () => void;
}) {
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
  const [rockType, setRockType] = useState("");
  const [hours, setHours] = useState("");
  const [sources, setSources] = useState<Source[]>([]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track whether we're returning from coordinate picking so we don't
  // reset the form (the useEffect below fires when `open` toggles).
  const pickingRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    // Skip resetting form values when returning from map pick
    if (pickingRef.current) {
      pickingRef.current = false;
      return;
    }
    const attr = canyon.attributes;
    setName(canyon.name);
    setAltNames(canyon.altNames.join(", "));
    setLatitude(String(canyon.latitude));
    setLongitude(String(canyon.longitude));
    setNumAbseils(canyon.numAbseils != null ? String(canyon.numAbseils) : "");
    setLongestAbseil(
      canyon.longestAbseil != null ? String(canyon.longestAbseil) : "",
    );
    setNotes(canyon.notes ?? "");
    setVGrade(attr.v_grade ?? "");
    setAGrade(attr.a_grade ?? "");
    setCommitment(attr.commitment ?? "");
    setQuality(attr.quality ?? "");
    setWetsuits(attr.wetsuits ?? "");
    setRockType(attr.rock_type ?? "");
    setHours(attr.hours != null ? String(attr.hours) : "");
    setSources((attr.sources ?? []).map(([label, url]) => ({ label, url })));
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
      if (isNaN(parsedLat) || isNaN(parsedLng)) {
        setError("Invalid coordinates");
        setSaving(false);
        return;
      }
      if (!name.trim()) {
        setError("Name is required");
        setSaving(false);
        return;
      }

      const cleanSources: [string, string][] = sources
        .filter((s) => s.label.trim())
        .map((s) => [s.label.trim(), s.url.trim()]);

      await updateCanyon(canyon.id, {
        name: name.trim(),
        altNames: altNames
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        latitude: parsedLat,
        longitude: parsedLng,
        numAbseils: numAbseils ? parseInt(numAbseils) : null,
        longestAbseil: longestAbseil ? parseFloat(longestAbseil) : null,
        notes: notes || null,
        attributes: {
          ...canyon.attributes,
          ...(vGrade !== "" ? { v_grade: vGrade as TCanyonAttributes["v_grade"] } : {}),
          ...(aGrade !== "" ? { a_grade: aGrade as TCanyonAttributes["a_grade"] } : {}),
          ...(commitment !== "" ? { commitment: commitment as TCanyonAttributes["commitment"] } : {}),
          ...(quality !== "" ? { quality } : {}),
          ...(wetsuits !== "" ? { wetsuits: wetsuits as TCanyonAttributes["wetsuits"] } : {}),
          rock_type: rockType || undefined,
          ...(hours ? { hours: parseFloat(hours) } : {}),
          sources: cleanSources.length > 0 ? cleanSources : undefined,
        },
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
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
          backgroundColor: "var(--sandstone-dark)",
          color: "var(--content-color)",
        },
      }}
    >
      <DialogTitle>Edit Canyon</DialogTitle>
      <DialogContent>
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
              variant="outlined"
              sx={{
                whiteSpace: "nowrap",
                minWidth: "auto",
                height: "40px",
                color: "var(--content-color)",
                borderColor: "var(--sandstone-light)",
                "&:hover": {
                  borderColor: "var(--content-color)",
                  backgroundColor: "rgba(255,255,255,0.08)",
                },
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
            label="Rock Type"
            value={rockType}
            onChange={(e) => setRockType(e.target.value)}
            size="small"
          />
          <TextField
            label="Notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            multiline
            minRows={2}
            size="small"
          />

          {/* Sources list */}
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
                    color: "#e57373",
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
                color: "var(--content-color)",
                borderColor: "var(--sandstone-light)",
                "&:hover": {
                  borderColor: "var(--content-color)",
                  backgroundColor: "rgba(255,255,255,0.08)",
                },
              }}
              onClick={() => setSources([...sources, { label: "", url: "" }])}
            >
              + Add Source
            </Button>
          </Box>

          {error && (
            <Box sx={{ color: "error.main", fontSize: "0.875rem" }}>
              {error}
            </Box>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button
          onClick={() => {
            onCancelPickCoords();
            onClose();
          }}
          disabled={saving}
        >
          Cancel
        </Button>
        <Button variant="contained" onClick={handleSave} disabled={saving}>
          {saving ? <CircularProgress size={20} /> : "Save"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default EditCanyonDialog;
