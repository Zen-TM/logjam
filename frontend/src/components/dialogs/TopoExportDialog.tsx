import { useState, useMemo } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  IconButton,
  Typography,
  FormControl,
  FormControlLabel,
  Checkbox,
  RadioGroup,
  Radio,
  CircularProgress,
  Tooltip,
  Box,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { apiFetch } from "../../canyonUtils";
import { messageFromError } from "../../errors/messageFromError";
import { ErrorBanner } from "../feedback/ErrorBanner";
import { TOPO_LAYERS, type CompletedTopoJob } from "../../topoLayerTypes";

type ExportFormat = "mbtiles" | "geotiff" | "geojson";
type Bundling = "perLayer" | "composite";

type LayerName = (typeof TOPO_LAYERS)[number]["name"];

interface Props {
  open: boolean;
  onClose: () => void;
  job: CompletedTopoJob | null;
}

const ALL_LAYER_NAMES = TOPO_LAYERS.map((l) => l.name);

function layersForFormat(format: ExportFormat): LayerName[] {
  if (format === "geotiff") return TOPO_LAYERS.filter((l) => l.format === "raster").map((l) => l.name);
  if (format === "geojson") return TOPO_LAYERS.filter((l) => l.format === "vector").map((l) => l.name);
  return ALL_LAYER_NAMES;
}

function fileExt(format: ExportFormat, name: LayerName): string {
  if (format === "mbtiles") return "mbtiles";
  if (format === "geotiff") return "tif";
  // GeoJSON exports use fixed pipeline filenames.
  return name === "contours" ? "geojson" : "geojson";
}

function downloadFilename(format: ExportFormat, name: LayerName): string {
  if (format === "geojson") {
    if (name === "contours") return "contours_5m.geojson";
    if (name === "features") return "osm_features.geojson";
  }
  return `${name}.${fileExt(format, name)}`;
}

// ── Minimal ZIP (store, no compression) ───────────────────────────────────
// Reused pattern from TopoDialog's shapefile builder. Browser-native ZIP
// support doesn't exist; bringing in JSZip just for this is overkill.
function buildStoreZip(files: { name: string; bytes: Uint8Array }[]): Blob {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    let crc = 0xffffffff;
    for (const b of f.bytes) {
      crc ^= b;
      for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    crc = (crc ^ 0xffffffff) >>> 0;

    const local = new Uint8Array(30 + nameBytes.length + f.bytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, 0, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, f.bytes.length, true);
    lv.setUint32(22, f.bytes.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(f.bytes, 30 + nameBytes.length);
    locals.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, f.bytes.length, true);
    cv.setUint32(24, f.bytes.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centrals.push(central);

    offset += local.length;
  }

  const centralSize = centrals.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  return new Blob([...locals, ...centrals, eocd], { type: "application/zip" });
}

function triggerDownload(blob: Blob | string, filename: string) {
  const url = typeof blob === "string" ? blob : URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  if (typeof blob !== "string") setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function TopoExportDialog({ open, onClose, job }: Props) {
  const [format, setFormat] = useState<ExportFormat>("mbtiles");
  const [selected, setSelected] = useState<Set<LayerName>>(() => new Set(ALL_LAYER_NAMES));
  const [bundling, setBundling] = useState<Bundling>("composite");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validLayersForCurrentFormat = useMemo(() => layersForFormat(format), [format]);

  // Whenever format changes, prune selected to those valid in the new format.
  const onFormatChange = (next: ExportFormat) => {
    setFormat(next);
    const valid = new Set(layersForFormat(next));
    setSelected((prev) => new Set([...prev].filter((l) => valid.has(l))));
    // Composite is only meaningful for MBTiles + all five layers; collapse to
    // per-layer otherwise so the user isn't stuck on a disabled option.
    if (next !== "mbtiles") setBundling("perLayer");
  };

  const toggleLayer = (name: LayerName) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const allFiveMbtiles =
    format === "mbtiles" && validLayersForCurrentFormat.every((l) => selected.has(l));
  const compositeAvailable = allFiveMbtiles;
  const effectiveBundling: Bundling = compositeAvailable ? bundling : "perLayer";

  const canSubmit = !submitting && job !== null && selected.size > 0;

  async function handleExport() {
    if (!job) return;
    setSubmitting(true);
    setError(null);
    try {
      const { urls } = await apiFetch<{ urls: { name: string; url: string }[] }>(
        `/topo-jobs/${job.jobId}/export-urls`,
        {
          method: "POST",
          body: { layers: [...selected], format },
        },
      );

      if (effectiveBundling === "composite" && urls.length === 1) {
        triggerDownload(urls[0].url, "composite.mbtiles");
        onClose();
        return;
      }

      // Per-layer: fetch each presigned URL, bundle into a ZIP, download once.
      const files = await Promise.all(
        urls.map(async (u) => {
          const res = await fetch(u.url);
          if (!res.ok) throw new Error(`Download failed for ${u.name}`);
          const bytes = new Uint8Array(await res.arrayBuffer());
          return { name: downloadFilename(format, u.name as LayerName), bytes };
        }),
      );
      const zip = buildStoreZip(files);
      const safeName = (job.name ?? job.jobId).replace(/[^a-z0-9_-]+/gi, "_");
      triggerDownload(zip, `${safeName}_${format}.zip`);
      onClose();
    } catch (err) {
      console.error(err);
      setError(messageFromError(err, "Export failed. Please try again."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
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
      <DialogTitle
        sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", pb: 1 }}
      >
        Export topo job
        <IconButton
          size="small"
          onClick={onClose}
          disabled={submitting}
          sx={{ color: "var(--theme-text-primary)" }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers sx={{ borderColor: "rgba(255,255,255,0.1)" }}>
        {job && (
          <Typography variant="body2" sx={{ mb: 2, color: "var(--theme-text-muted)" }}>
            {job.name ?? "Unnamed job"}
          </Typography>
        )}
        {error && <ErrorBanner message={error} />}

        <Box sx={{ mb: 2 }}>
          <Typography variant="caption" sx={{ color: "var(--theme-text-muted)" }}>Format</Typography>
          <RadioGroup row value={format} onChange={(e) => onFormatChange(e.target.value as ExportFormat)}>
            <FormControlLabel value="mbtiles" control={<Radio size="small" />} label="MBTiles" />
            <FormControlLabel value="geotiff" control={<Radio size="small" />} label="GeoTIFF (raster only)" />
            <FormControlLabel value="geojson" control={<Radio size="small" />} label="GeoJSON (vector only)" />
          </RadioGroup>
        </Box>

        <Box sx={{ mb: 2 }}>
          <Typography variant="caption" sx={{ color: "var(--theme-text-muted)" }}>Layers</Typography>
          <FormControl component="fieldset">
            {TOPO_LAYERS.map((l) => {
              const eligible = validLayersForCurrentFormat.includes(l.name);
              return (
                <FormControlLabel
                  key={l.name}
                  control={
                    <Checkbox
                      size="small"
                      checked={selected.has(l.name)}
                      disabled={!eligible}
                      onChange={() => toggleLayer(l.name)}
                    />
                  }
                  label={`${l.label}${!eligible ? ` (n/a for ${format})` : ""}`}
                />
              );
            })}
          </FormControl>
        </Box>

        <Box sx={{ mb: 1 }}>
          <Typography variant="caption" sx={{ color: "var(--theme-text-muted)" }}>Bundling</Typography>
          <RadioGroup
            row
            value={effectiveBundling}
            onChange={(e) => setBundling(e.target.value as Bundling)}
          >
            <FormControlLabel value="perLayer" control={<Radio size="small" />} label="One file per layer (ZIP)" />
            <Tooltip
              title={compositeAvailable ? "" : "Composite is only available with format=MBTiles and all five layers selected."}
              placement="top"
              arrow
            >
              <span>
                <FormControlLabel
                  value="composite"
                  control={<Radio size="small" />}
                  label="Single composite file"
                  disabled={!compositeAvailable}
                />
              </span>
            </Tooltip>
          </RadioGroup>
        </Box>

        <Typography variant="caption" sx={{ color: "var(--theme-text-muted)", display: "block", mt: 1 }}>
          Composite reflects vector style at the time the job was submitted; live
          vector style applies to in-app display only in this release.
        </Typography>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} disabled={submitting} sx={{ color: "var(--theme-text-primary)" }}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color="secondary"
          disabled={!canSubmit}
          onClick={handleExport}
        >
          {submitting ? <CircularProgress size={18} /> : "Export"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
