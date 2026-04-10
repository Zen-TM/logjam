import { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Checkbox,
  FormControlLabel,
  FormGroup,
  Typography,
  Box,
  CircularProgress,
  LinearProgress,
  Chip,
  IconButton,
  Divider,
  Alert,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import type { TBbox } from "../map/Map";
import { apiFetch } from "../../canyonUtils";
import { MASTER_TOPO_LAYERS } from "../../topoLayerTypes";

// ── Types ────────────────────────────────────────────────────────────────────

type TopoJobStatus =
  | "uploading"
  | "pending"
  | "processing"
  | "complete"
  | "failed";

type TopoJob = {
  id: string;
  status: TopoJobStatus;
  bbox: TBbox | null;
  layerOptions: string[] | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  s3OutputKeys:
    | { name: string; mbtilesKey: string; pmtilesKey: string }[]
    | null;
};

type DownloadUrl = {
  name: string;
  mbtilesUrl: string;
  pmtilesUrl: string | null;
};

// ── Constants ────────────────────────────────────────────────────────────────

const ALL_LAYERS = [
  ...MASTER_TOPO_LAYERS.map((l) => l.name),
  "composite",
] as const;
type LayerName = (typeof ALL_LAYERS)[number];

const LAYER_LABELS: Record<LayerName, string> = {
  ...Object.fromEntries(MASTER_TOPO_LAYERS.map((l) => [l.name, l.label])),
  features: "Features (OSM overlay)",
  composite: "Composite (all layers combined)",
} as Record<LayerName, string>;

function bboxAreaKm2(bbox: TBbox): number {
  const R = 6371;
  const dLat = ((bbox.north - bbox.south) * Math.PI) / 180;
  const dLon = ((bbox.east - bbox.west) * Math.PI) / 180;
  const midLat = (((bbox.north + bbox.south) / 2) * Math.PI) / 180;
  return R * R * dLat * dLon * Math.cos(midLat);
}

function estimateTime(km2: number): string {
  if (km2 < 10) return "~3–8 minutes";
  if (km2 < 50) return "~15–30 minutes";
  if (km2 < 100) return "~30–60 minutes";
  return "~45 minutes – 2 hours";
}

/**
 * Generates a single-polygon shapefile ZIP (WGS84) from a bbox and triggers
 * a browser download. The ZIP contains the four standard shapefile components
 * (.shp, .shx, .dbf, .prj) and can be uploaded directly to ELVIS "Load File".
 *
 * The shapefile binary format is hand-written here to avoid a dependency.
 * Reference: ESRI Shapefile Technical Description (July 1998).
 */
function downloadBboxShapefile(bbox: TBbox) {
  const { west, south, east, north } = bbox;

  // Ring: 5 points (closed), clockwise
  const ring: [number, number][] = [
    [west, south],
    [west, north],
    [east, north],
    [east, south],
    [west, south],
  ];

  // ── .shp ────────────────────────────────────────────────────────────────
  // File header (100 bytes) + record header (8 bytes) + polygon content
  const numPoints = ring.length;
  // contentLength: size of record content in 16-bit words (per shapefile spec)
  //   shape type (Int32):        4 bytes =  2 words
  //   bbox (4 × Float64):       32 bytes = 16 words
  //   num parts (Int32):         4 bytes =  2 words
  //   num points (Int32):        4 bytes =  2 words
  //   parts[0] (Int32):          4 bytes =  2 words
  //   points (n × 2 × Float64): n×16 bytes = n×8 words
  const contentLength = 2 + 16 + 2 + 2 + 2 + numPoints * 8; // in 16-bit words
  const shpSize = 50 + 4 + contentLength; // in 16-bit words

  const shp = new DataView(new ArrayBuffer(shpSize * 2));
  let o = 0;

  // File header
  shp.setInt32(o, 9994, false);
  o += 4; // magic
  o += 20; // unused
  shp.setInt32(o, shpSize, false);
  o += 4; // file length (16-bit words)
  shp.setInt32(o, 1000, true);
  o += 4; // version
  shp.setInt32(o, 5, true);
  o += 4; // shape type: polygon
  shp.setFloat64(o, west, true);
  o += 8; // bbox
  shp.setFloat64(o, south, true);
  o += 8;
  shp.setFloat64(o, east, true);
  o += 8;
  shp.setFloat64(o, north, true);
  o += 8;
  o += 32; // Z/M ranges (zeros)

  // Record header
  shp.setInt32(o, 1, false);
  o += 4; // record number
  shp.setInt32(o, contentLength, false);
  o += 4; // content length (16-bit words)

  // Polygon record
  shp.setInt32(o, 5, true);
  o += 4; // shape type: polygon
  shp.setFloat64(o, west, true);
  o += 8;
  shp.setFloat64(o, south, true);
  o += 8;
  shp.setFloat64(o, east, true);
  o += 8;
  shp.setFloat64(o, north, true);
  o += 8;
  shp.setInt32(o, 1, true);
  o += 4; // num parts
  shp.setInt32(o, numPoints, true);
  o += 4; // num points
  shp.setInt32(o, 0, true);
  o += 4; // part 0 starts at index 0
  for (const [x, y] of ring) {
    shp.setFloat64(o, x, true);
    o += 8;
    shp.setFloat64(o, y, true);
    o += 8;
  }

  // ── .shx ────────────────────────────────────────────────────────────────
  const shx = new DataView(new ArrayBuffer(108));
  let sx = 0;
  shx.setInt32(sx, 9994, false);
  sx += 4;
  sx += 20;
  shx.setInt32(sx, 54, false);
  sx += 4; // file length: 50 header + 4 per record
  shx.setInt32(sx, 1000, true);
  sx += 4;
  shx.setInt32(sx, 5, true);
  sx += 4;
  shx.setFloat64(sx, west, true);
  sx += 8;
  shx.setFloat64(sx, south, true);
  sx += 8;
  shx.setFloat64(sx, east, true);
  sx += 8;
  shx.setFloat64(sx, north, true);
  sx += 8;
  sx += 32;
  shx.setInt32(sx, 50, false);
  sx += 4; // offset of record 1 (16-bit words)
  shx.setInt32(sx, contentLength, false); // content length of record 1

  // ── .dbf ────────────────────────────────────────────────────────────────
  // Minimal dBASE III+ with a single "name" field
  // Header: 32 (file header) + 32 (field descriptor) + 1 (terminator) = 65 bytes
  // Records: 1 record × (1 deletion flag + 10 char field) = 11 bytes
  // Total: 76 bytes
  const enc = new TextEncoder();
  const dbf = new Uint8Array(76);
  dbf[0] = 3; // version
  dbf[4] = 1; // num records (low byte)
  dbf[8] = 65; // header size in bytes (32 + 1×32 + 1)
  dbf[10] = 11; // record size (1 deletion flag + 10 chars)
  // Field descriptor at offset 32: NAME, type C, length 10
  dbf.set(enc.encode("NAME"), 32);
  dbf[32 + 11] = 67; // type 'C'
  dbf[32 + 16] = 10; // field length
  dbf[64] = 0x0d; // header terminator
  dbf[65] = 0x20; // deletion flag (space = not deleted)
  dbf.set(enc.encode("topo_area "), 66); // field value (10 chars, padded with space)

  // ── .prj ────────────────────────────────────────────────────────────────
  const prj = enc.encode(
    'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],' +
      'PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]',
  );

  // ── ZIP ─────────────────────────────────────────────────────────────────
  // Build a minimal ZIP manually (store, no compression)
  function zipEntry(name: string, data: Uint8Array, offset: number) {
    const nameBytes = enc.encode(name);
    // CRC-32
    let crc = 0xffffffff;
    for (const b of data) {
      crc ^= b;
      for (let i = 0; i < 8; i++)
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    crc = (crc ^ 0xffffffff) >>> 0;

    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); // local file header signature
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(8, 0, true); // compression: store
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true); // compressed size
    lv.setUint32(22, data.length, true); // uncompressed size
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); // central dir signature
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true); // offset of local header
    central.set(nameBytes, 46);

    return { local, central };
  }

  const files: { name: string; data: Uint8Array }[] = [
    { name: "topo_area.shp", data: new Uint8Array(shp.buffer) },
    { name: "topo_area.shx", data: new Uint8Array(shx.buffer) },
    { name: "topo_area.dbf", data: dbf },
    { name: "topo_area.prj", data: prj },
  ];

  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let localOffset = 0;

  for (const f of files) {
    const { local, central } = zipEntry(f.name, f.data, localOffset);
    locals.push(local);
    centrals.push(central);
    localOffset += local.length;
  }

  const centralOffset = localOffset;
  const centralSize = centrals.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, centralOffset, true);

  const total = [...locals, ...centrals, eocd].reduce(
    (s, a) => s + a.length,
    0,
  );
  const zip = new Uint8Array(total);
  let pos = 0;
  for (const a of [...locals, ...centrals, eocd]) {
    zip.set(a, pos);
    pos += a.length;
  }

  const blob = new Blob([zip], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "topo_area.zip";
  a.click();
  URL.revokeObjectURL(url);
}

// ── Component ────────────────────────────────────────────────────────────────

export default function TopoDialog({
  open,
  onClose,
  onSelectBbox,
  pendingBbox,
  onLayersToggle,
}: {
  open: boolean;
  onClose: () => void;
  onSelectBbox: () => void;
  pendingBbox: TBbox | null;
  onLayersToggle: (layers: { id: string; pmtilesUrl: string }[]) => void;
}) {
  const [selectedLayers, setSelectedLayers] = useState<Set<LayerName>>(
    new Set(["composite"]),
  );
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Active job being tracked
  const [job, setJob] = useState<TopoJob | null>(null);
  const [downloadUrls, setDownloadUrls] = useState<DownloadUrl[] | null>(null);

  // Overlay layers currently shown on the map: { id, pmtilesUrl }[]
  const [overlayIds, setOverlayIds] = useState<Set<string>>(new Set());
  const overlayLayersRef = useRef<{ id: string; pmtilesUrl: string }[]>([]);

  // Poll for job status
  useEffect(() => {
    if (!job || job.status === "complete" || job.status === "failed") return;
    const interval = setInterval(async () => {
      try {
        const updated = await apiFetch<TopoJob>(`/topo-jobs/${job.id}`);
        setJob(updated);
        if (updated.status === "complete") {
          const urls = await apiFetch<DownloadUrl[]>(
            `/topo-jobs/${job.id}/download-urls`,
          );
          setDownloadUrls(urls);
        }
      } catch (e) {
        console.error("Job status poll failed:", e);
      }
    }, 10_000);
    return () => clearInterval(interval);
  }, [job]);

  function toggleLayer(name: LayerName) {
    setSelectedLayers((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }

  async function handleSubmit() {
    if (!pendingBbox || !file) return;
    setError(null);
    setSubmitting(true);
    try {
      const layers = [...selectedLayers];
      // Create job + get presigned upload URL
      const { jobId, uploadUrl } = await apiFetch<{
        jobId: string;
        uploadUrl: string;
      }>("/topo-jobs", {
        method: "POST",
        body: { bbox: pendingBbox, layerOptions: layers, filename: file.name },
      });

      // Upload ZIP directly to S3
      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": "application/zip" },
      });
      if (!uploadRes.ok) throw new Error("ZIP upload failed");

      // Submit job to queue
      await apiFetch(`/topo-jobs/${jobId}/start`, { method: "POST" });

      const newJob = await apiFetch<TopoJob>(`/topo-jobs/${jobId}`);
      setJob(newJob);
      setFile(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  }

  function toggleMapOverlay(url: DownloadUrl) {
    const layerId = `${job!.id}-${url.name}`;
    setOverlayIds((prev) => {
      const next = new Set(prev);
      if (next.has(layerId)) {
        next.delete(layerId);
      } else {
        next.add(layerId);
      }
      // Rebuild overlay layers list and notify parent
      const all = downloadUrls ?? [];
      const newLayers = all
        .filter((u) => u.pmtilesUrl && next.has(`${job!.id}-${u.name}`))
        .map((u) => ({
          id: `${job!.id}-${u.name}`,
          pmtilesUrl: u.pmtilesUrl!,
        }));
      overlayLayersRef.current = newLayers;
      onLayersToggle(newLayers);
      return next;
    });
  }

  function handleClose() {
    if (submitting) return;
    onClose();
  }

  const area = pendingBbox ? bboxAreaKm2(pendingBbox) : null;

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        Generate Topo Map
        <IconButton onClick={handleClose} size="small">
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers>
        {/* ── View: complete ── */}
        {job?.status === "complete" && downloadUrls && (
          <Box>
            <Alert severity="success" sx={{ mb: 2 }}>
              Topo map is ready! A download link has been emailed to you.
            </Alert>
            <Typography variant="subtitle2" gutterBottom>
              Downloads
            </Typography>
            {downloadUrls.map((u) => {
              const layerId = `${job.id}-${u.name}`;
              return (
                <Box
                  key={u.name}
                  sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}
                >
                  <Button
                    size="small"
                    variant="outlined"
                    href={u.mbtilesUrl}
                    download={`${u.name}.mbtiles`}
                    sx={{ textTransform: "none", minWidth: 160 }}
                  >
                    {u.name}.mbtiles
                  </Button>
                  {u.pmtilesUrl && (
                    <Button
                      size="small"
                      variant={
                        overlayIds.has(layerId) ? "contained" : "outlined"
                      }
                      onClick={() => toggleMapOverlay(u)}
                      sx={{ textTransform: "none" }}
                    >
                      {overlayIds.has(layerId) ? "Hide on map" : "Show on map"}
                    </Button>
                  )}
                </Box>
              );
            })}
          </Box>
        )}

        {/* ── View: failed ── */}
        {job?.status === "failed" && (
          <Alert severity="error">
            Processing failed: {job.errorMessage ?? "Unknown error"}
          </Alert>
        )}

        {/* ── View: processing/pending ── */}
        {(job?.status === "processing" || job?.status === "pending") && (
          <Box sx={{ textAlign: "center", py: 2 }}>
            <CircularProgress sx={{ mb: 2 }} />
            <Typography>
              {job.status === "pending"
                ? "Queued — waiting for worker…"
                : "Processing LiDAR data…"}
            </Typography>
            {job.bbox && (
              <Typography variant="caption" color="text.secondary">
                Estimated time: {estimateTime(bboxAreaKm2(job.bbox))}
              </Typography>
            )}
            <LinearProgress sx={{ mt: 2 }} />
          </Box>
        )}

        {/* ── View: setup ── */}
        {!job && (
          <>
            {/* Step 1: Draw bbox */}
            <Typography variant="subtitle2" gutterBottom>
              1. Define area
            </Typography>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
              <Button
                variant="outlined"
                size="small"
                onClick={onSelectBbox}
                sx={{ textTransform: "none" }}
              >
                Draw on map
              </Button>
              {pendingBbox && (
                <Chip
                  size="small"
                  label={`${area?.toFixed(0)} km² · ${estimateTime(area!)}`}
                  color="success"
                  variant="outlined"
                />
              )}
            </Box>

            <Divider sx={{ my: 2 }} />

            {/* Step 2: Layer selection */}
            <Typography variant="subtitle2" gutterBottom>
              2. Select layers
            </Typography>
            <FormGroup>
              {ALL_LAYERS.map((name) => (
                <FormControlLabel
                  key={name}
                  control={
                    <Checkbox
                      checked={selectedLayers.has(name)}
                      onChange={() => toggleLayer(name)}
                      size="small"
                    />
                  }
                  label={LAYER_LABELS[name]}
                />
              ))}
            </FormGroup>

            <Divider sx={{ my: 2 }} />

            {/* Step 3: Download from ELVIS + upload */}
            <Typography variant="subtitle2" gutterBottom>
              3. Upload ELVIS ZIP
            </Typography>
            <Box
              sx={{ pl: 2, display: "flex", flexDirection: "column", gap: 1 }}
            >
              {/* 3a */}
              <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ minWidth: 16 }}
                >
                  a.
                </Typography>
                {pendingBbox ? (
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => downloadBboxShapefile(pendingBbox)}
                    sx={{ textTransform: "none" }}
                  >
                    Download area shapefile
                  </Button>
                ) : (
                  <Typography
                    variant="body2"
                    color="text.disabled"
                    sx={{ fontStyle: "italic" }}
                  >
                    Define area above, then download area shapefile
                  </Typography>
                )}
              </Box>

              {/* 3b */}
              <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ minWidth: 16 }}
                >
                  b.
                </Typography>
                <Button
                  size="small"
                  variant="outlined"
                  href="https://elevation.fsdf.org.au/"
                  target="_blank"
                  rel="noopener noreferrer"
                  sx={{ textTransform: "none" }}
                >
                  Open ELVIS portal ↗
                </Button>
              </Box>

              {/* 3c–e */}
              <Box sx={{ display: "flex", gap: 1.5 }}>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ minWidth: 16 }}
                >
                  c.
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Click 'Order Data' → 'Load File' and upload the shapefile ZIP
                  downloaded in step a.
                </Typography>
              </Box>
              <Box sx={{ display: "flex", gap: 1.5 }}>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ minWidth: 16 }}
                >
                  d.
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Under 'NSW Government - Spatial Services' → 'Point Clouds',
                  beside 'AHD', click 'Select all'.
                </Typography>
              </Box>
              <Box sx={{ display: "flex", gap: 1.5 }}>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ minWidth: 16 }}
                >
                  e.
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Under 'Industry', select 'Recreation'. Enter your email and
                  click 'Order x Datasets'.
                </Typography>
              </Box>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ minWidth: 16 }}
                >
                  f.
                </Typography>
                <Button
                  variant="outlined"
                  component="label"
                  size="small"
                  sx={{ textTransform: "none" }}
                >
                  {file ? file.name : "Upload downloaded ZIP…"}
                  <input
                    type="file"
                    accept=".zip"
                    hidden
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                </Button>
              </Box>
            </Box>

            {error && (
              <Alert severity="error" sx={{ mt: 2 }}>
                {error}
              </Alert>
            )}
          </>
        )}
      </DialogContent>

      <DialogActions>
        {!job && (
          <>
            <Button onClick={handleClose} disabled={submitting}>
              Cancel
            </Button>
            <Button
              variant="contained"
              onClick={handleSubmit}
              disabled={!pendingBbox || !file || submitting}
            >
              {submitting ? <CircularProgress size={18} /> : "Submit"}
            </Button>
          </>
        )}
        {(job?.status === "complete" || job?.status === "failed") && (
          <Button
            onClick={() => {
              setJob(null);
              setDownloadUrls(null);
              setOverlayIds(new Set());
            }}
          >
            New job
          </Button>
        )}
        {(job?.status === "processing" || job?.status === "pending") && (
          <Button onClick={handleClose}>
            Close (job continues in background)
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
