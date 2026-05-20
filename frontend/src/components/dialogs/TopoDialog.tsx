import { useState, useRef, Fragment } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  CircularProgress,
  LinearProgress,
  Chip,
  IconButton,
  Divider,
  Tooltip,
  Collapse,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import { apiFetch } from "../../canyonUtils";
import { messageFromError } from "../../errors/messageFromError";
import { ErrorBanner } from "../feedback/ErrorBanner";
import type { TBbox } from "../map/Map";

// ── Types ────────────────────────────────────────────────────────────────────

export type TopoJobStatus =
  | "uploading"
  | "pending"
  | "processing"
  | "complete"
  | "failed";

export type GeoJsonPolygon = {
  type: string;
  coordinates: number[][][];
};

export type TopoJob = {
  id: string;
  status: TopoJobStatus;
  name: string | null;
  footprint: GeoJsonPolygon | null;
  tileCount: number | null;
  estimatedSeconds: number | null;
  layerOptions: string[] | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  s3OutputKeys:
    | { name: string; mbtilesKey: string; pmtilesKey: string | null }[]
    | null;
};

export type DownloadUrl = {
  name: string;
  mbtilesUrl: string;
  pmtilesUrl: string | null;
};

const INSTRUCTIONS_KEY = "topoDialogShowInstructions";

async function parseElvisZip(
  file: File,
): Promise<{ tileCount: number; jobName: string | null }> {
  const tail = await file.slice(file.size - 22, file.size).arrayBuffer();
  const eocd = new DataView(tail);
  if (eocd.getUint32(0, true) !== 0x06054b50)
    return { tileCount: 0, jobName: null };
  const cdOffset = eocd.getUint32(16, true);
  const cdSize = eocd.getUint32(12, true);
  const cdBuf = await file.slice(cdOffset, cdOffset + cdSize).arrayBuffer();
  const cd = new DataView(cdBuf);
  let tileCount = 0;
  const nameFreq: Record<string, number> = {};
  let pos = 0;
  while (pos < cdBuf.byteLength - 4) {
    if (cd.getUint32(pos, true) !== 0x02014b50) break;
    const fnLen = cd.getUint16(pos + 28, true);
    const extraLen = cd.getUint16(pos + 30, true);
    const commentLen = cd.getUint16(pos + 32, true);
    const fn = new TextDecoder().decode(new Uint8Array(cdBuf, pos + 46, fnLen));
    if (
      fn.toLowerCase().endsWith(".laz") ||
      fn.toLowerCase().endsWith(".las")
    ) {
      tileCount++;
      const base = (fn.split("/").pop() ?? fn).replace(/\.[^.]+$/, "");
      const match = base.match(/^([A-Za-z]+)/);
      if (match) nameFreq[match[1]] = (nameFreq[match[1]] ?? 0) + 1;
    }
    pos += 46 + fnLen + extraLen + commentLen;
  }
  let jobName: string | null = null;
  let maxCount = 0;
  for (const [name, count] of Object.entries(nameFreq)) {
    if (count > maxCount) {
      maxCount = count;
      jobName = name;
    }
  }
  return { tileCount, jobName };
}

function bboxAreaKm2(bbox: TBbox): number {
  const R = 6371;
  const dLat = ((bbox.north - bbox.south) * Math.PI) / 180;
  const dLon = ((bbox.east - bbox.west) * Math.PI) / 180;
  const midLat = (((bbox.north + bbox.south) / 2) * Math.PI) / 180;
  return R * R * dLat * dLon * Math.cos(midLat);
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

const outlinedAccentSx = {
  textTransform: "none",
  color: "var(--theme-accent)",
  borderColor: "var(--theme-accent)",
  "&:hover": {
    borderColor: "var(--theme-accent)",
    backgroundColor: "color-mix(in srgb, var(--theme-accent) 12%, transparent)",
  },
} as const;

export default function TopoDialog({
  open,
  onClose,
  onSelectBbox,
  pendingBbox,
  jobs,
  downloadUrlsMap,
  onJobCreated,
}: {
  open: boolean;
  onClose: () => void;
  onSelectBbox: () => void;
  pendingBbox: TBbox | null;
  jobs: TopoJob[];
  downloadUrlsMap: Record<string, DownloadUrl[]>;
  onJobCreated: (job: TopoJob) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [showInstructions, setShowInstructions] = useState(
    () => localStorage.getItem(INSTRUCTIONS_KEY) === "true",
  );

  const fileInputRef = useRef<HTMLInputElement>(null);

  function toggleInstructions() {
    setShowInstructions((prev) => {
      const next = !prev;
      localStorage.setItem(INSTRUCTIONS_KEY, String(next));
      return next;
    });
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(true);
  }

  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped?.name.toLowerCase().endsWith(".zip")) {
      setFile(dropped);
    }
  }

  async function handleSubmit() {
    if (!file) return;
    setError(null);
    setSubmitting(true);
    try {
      const { tileCount, jobName } = await parseElvisZip(file);
      const { jobId, uploadUrl } = await apiFetch<{
        jobId: string;
        uploadUrl: string;
      }>("/topo-jobs", {
        method: "POST",
        body: {
          tileCount: tileCount || null,
          jobName: jobName || null,
          filename: file.name,
        },
      });

      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": "application/zip" },
      });
      if (!uploadRes.ok) throw new Error("ZIP upload failed");

      await apiFetch(`/topo-jobs/${jobId}/start`, { method: "POST" });

      const newJob = await apiFetch<TopoJob>(`/topo-jobs/${jobId}`);
      onJobCreated(newJob);
      setFile(null);
    } catch (e: unknown) {
      console.error(e);
      setError(messageFromError(e, "Submission failed. Please try again."));
    } finally {
      setSubmitting(false);
    }
  }

  function handleClose() {
    if (submitting) return;
    onClose();
  }

  const area = pendingBbox ? bboxAreaKm2(pendingBbox) : null;

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          backgroundColor: "var(--theme-primary)",
          color: "var(--theme-text-primary)",
          maxHeight: "85vh",
        },
      }}
    >
      <DialogTitle
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        Generate Topo Map
        <IconButton
          onClick={handleClose}
          size="small"
          sx={{ color: "var(--theme-text-primary)" }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers sx={{ borderColor: "rgba(255,255,255,0.1)" }}>
        {/* ── Job status list ── */}
        {jobs.filter((j) => j.status !== "complete").length > 0 && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle2" gutterBottom>
              Jobs
            </Typography>
            {jobs
              .filter((j) => j.status !== "complete")
              .map((j) => {
                const urls = downloadUrlsMap[j.id] ?? null;
                const isRunning =
                  j.status === "pending" || j.status === "processing";
                const isComplete = j.status === "complete";
                const isFailed = j.status === "failed";
                return (
                  <Box key={j.id} sx={{ mb: 1.5 }}>
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 1,
                        mb: 0.5,
                      }}
                    >
                      {isRunning && <CircularProgress size={14} />}
                      <Chip
                        size="small"
                        label={
                          j.status === "pending"
                            ? "Queued"
                            : j.status === "processing"
                              ? "Processing"
                              : j.status === "complete"
                                ? "Complete"
                                : "Failed"
                        }
                        color={
                          isComplete
                            ? "success"
                            : isFailed
                              ? "error"
                              : "default"
                        }
                      />
                      {j.name && (
                        <Typography variant="body2" sx={{ fontWeight: 500 }}>
                          {j.name}
                        </Typography>
                      )}
                      {isRunning && j.estimatedSeconds != null && (
                        <Typography variant="caption" color="text.secondary">
                          ~{Math.round(j.estimatedSeconds / 60)} min
                        </Typography>
                      )}
                    </Box>
                    {isRunning && <LinearProgress sx={{ mb: 0.5 }} />}
                    {isFailed && (
                      <Typography variant="caption" color="error">
                        {j.errorMessage ?? "Processing failed. Please try again."}
                      </Typography>
                    )}
                    {isComplete && urls && (
                      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                        {urls.map((u) => (
                          <Fragment key={u.name}>
                            <Button
                              size="small"
                              variant="outlined"
                              href={u.mbtilesUrl}
                              download={`${u.name}.mbtiles`}
                              sx={outlinedAccentSx}
                            >
                              {u.name}.mbtiles
                            </Button>
                          </Fragment>
                        ))}
                      </Box>
                    )}
                  </Box>
                );
              })}
            <Divider
              sx={{ mt: 1, mb: 2, borderColor: "rgba(255,255,255,0.1)" }}
            />
          </Box>
        )}

        {/* ── Instructions toggle ── */}
        <Box
          component="button"
          onClick={toggleInstructions}
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--theme-text-muted)",
            fontSize: "0.8rem",
            p: 0,
            mb: 2,
            "&:hover": { color: "var(--theme-text-primary)" },
            transition: "color var(--transition-fast)",
          }}
        >
          {showInstructions ? (
            <ExpandLessIcon sx={{ fontSize: 16 }} />
          ) : (
            <ExpandMoreIcon sx={{ fontSize: 16 }} />
          )}
          {showInstructions ? "Hide instructions" : "How to get an ELVIS ZIP"}
        </Box>

        {/* ── Collapsible instructions ── */}
        <Collapse in={showInstructions}>
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              gap: 1,
              mb: 2,
              pl: 1,
            }}
          >
            {/* Step 1: Draw area + shapefile */}
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1.5,
                flexWrap: "wrap",
              }}
            >
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ minWidth: 16 }}
              >
                1.
              </Typography>
              <Button
                size="small"
                variant="outlined"
                onClick={onSelectBbox}
                sx={outlinedAccentSx}
              >
                Draw area on map
              </Button>
              {pendingBbox ? (
                <>
                  <Chip
                    size="small"
                    label={`${area?.toFixed(0)} km²`}
                    variant="outlined"
                    sx={{
                      color: "var(--theme-text-muted)",
                      borderColor: "var(--theme-text-muted)",
                    }}
                  />
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => downloadBboxShapefile(pendingBbox)}
                    sx={outlinedAccentSx}
                  >
                    Download shapefile
                  </Button>
                </>
              ) : (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ fontStyle: "italic" }}
                >
                  then download shapefile
                </Typography>
              )}
            </Box>

            {/* Step 2: Open ELVIS portal */}
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ minWidth: 16 }}
              >
                2.
              </Typography>
              <Button
                size="small"
                variant="outlined"
                href="https://elevation.fsdf.org.au/"
                target="_blank"
                rel="noopener noreferrer"
                sx={outlinedAccentSx}
              >
                Open ELVIS portal ↗
              </Button>
            </Box>

            {/* Step 3: Load file + search */}
            <Box sx={{ display: "flex", gap: 1.5, alignItems: "flex-start" }}>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ minWidth: 16 }}
              >
                3.
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Click 'Order Data' → draw your area or 'Load File' to upload a
                shapefile, then click 'Search'.
              </Typography>
              <Tooltip
                title={
                  <>
                    <strong>Faster processing:</strong> You can also include
                    ELVIS DEM (Digital Elevation Model) files alongside the
                    point cloud. DEM files must cover the entire selected area.
                    <br />
                    <br />
                    <strong>Fastest (no vegetation layer):</strong> Select{" "}
                    <em>only</em> DEM files — no point cloud needed. The
                    vegetation density layer will not be generated.
                  </>
                }
                arrow
                placement="right"
              >
                <InfoOutlinedIcon
                  fontSize="small"
                  sx={{
                    color: "var(--theme-text-muted)",
                    cursor: "help",
                    flexShrink: 0,
                    mt: "2px",
                  }}
                />
              </Tooltip>
            </Box>

            {/* Step 4: Select point clouds */}
            <Box sx={{ display: "flex", gap: 1.5 }}>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ minWidth: 16 }}
              >
                4.
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Under 'NSW Government - Spatial Services' → 'Point Clouds',
                beside 'AHD', click 'Select all'.
              </Typography>
            </Box>

            {/* Step 5: Order datasets */}
            <Box sx={{ display: "flex", gap: 1.5 }}>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ minWidth: 16 }}
              >
                5.
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Under 'Industry', select 'Recreation'. Enter your email and
                click 'Order x Datasets'.
              </Typography>
            </Box>
          </Box>
        </Collapse>

        {/* ── Upload zone (hero) ── */}
        <Box
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          sx={{
            border: `2px dashed ${dragging ? "var(--theme-accent)" : "rgba(255,255,255,0.18)"}`,
            borderRadius: "var(--radius-md)",
            p: 3,
            textAlign: "center",
            cursor: "pointer",
            backgroundColor: dragging
              ? "color-mix(in srgb, var(--theme-accent) 8%, transparent)"
              : "rgba(255,255,255,0.02)",
            transition:
              "border-color var(--transition-fast), background-color var(--transition-fast)",
            "&:hover": {
              borderColor: "var(--theme-accent)",
              backgroundColor:
                "color-mix(in srgb, var(--theme-accent) 8%, transparent)",
            },
          }}
        >
          <UploadFileIcon
            sx={{
              fontSize: 36,
              color: file ? "var(--theme-accent)" : "var(--theme-text-muted)",
              mb: 0.5,
            }}
          />
          <Typography
            variant="body2"
            sx={{
              color: file
                ? "var(--theme-text-primary)"
                : "var(--theme-text-muted)",
            }}
          >
            {file ? file.name : "Drop ELVIS ZIP here, or click to browse"}
          </Typography>
          {file && (
            <Typography variant="caption" color="text.secondary">
              Click to change file
            </Typography>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip"
            hidden
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </Box>

        {error && <ErrorBanner message={error} />}
      </DialogContent>

      <DialogActions>
        <Button
          onClick={handleClose}
          disabled={submitting}
          sx={{ color: "var(--theme-text-primary)" }}
        >
          Cancel
        </Button>
        <Button
          variant="contained"
          color="secondary"
          onClick={handleSubmit}
          disabled={!file || submitting}
        >
          {submitting ? <CircularProgress size={18} /> : "Submit"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
