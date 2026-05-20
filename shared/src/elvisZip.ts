export type ElvisZipErrorCode = "NOT_A_ZIP" | "TRUNCATED" | "NO_USABLE_FILES" | "EMPTY_ZIP";

export class ElvisZipError extends Error {
  code: ElvisZipErrorCode;
  constructor(code: ElvisZipErrorCode, message: string) {
    super(message);
    this.name = "ElvisZipError";
    this.code = code;
  }
}

export interface ZipEntry {
  filename: string;
  compressedSize: number;
  uncompressedSize: number;
}

export interface ElvisStats {
  surveyNames: string[];
  mode: "DEM_LAZ" | "DEM_ONLY" | "LAZ_ONLY";
  modeLabel: string;
  tileCount: number;
  lazCount: number;
  demCount: number;
  derivativeTifCount: number;
  demResolutionMeters: number | null;
  uncompressedBytes: number;
  compressedBytes: number;
}

// Matches topo/topo_mbtiles.py derivative filter (case-insensitive stem contains any of these)
export const DERIVATIVE_STEM_TOKENS = [
  "hillshade",
  "slope",
  "aspect",
  "colour",
  "color",
  "rgb",
] as const;

/**
 * Parses the ZIP central directory from the trailing bytes of a zip file.
 *
 * `tailBytes` must be the last N bytes of the file (N ≥ 22, typically 65536).
 * `totalFileSize` is the full file size so we can compute absolute offsets.
 *
 * Throws ElvisZipError if the data is not a valid ZIP or the central directory
 * does not fit within tailBytes (zip too large — increase tail window).
 */
export function parseZipCentralDirectory(
  tailBytes: Uint8Array,
  totalFileSize: number,
): ZipEntry[] {
  if (tailBytes.length < 22) {
    throw new ElvisZipError("NOT_A_ZIP", "Not a valid ZIP file (too small).");
  }

  // Search backward for EOCD signature (0x06054b50) — handles zip comments up to tail length
  const tailView = new DataView(
    tailBytes.buffer,
    tailBytes.byteOffset,
    tailBytes.byteLength,
  );
  let eocdPos = -1;
  for (let i = tailBytes.length - 22; i >= 0; i--) {
    if (tailView.getUint32(i, true) === 0x06054b50) {
      eocdPos = i;
      break;
    }
  }
  if (eocdPos === -1) {
    throw new ElvisZipError(
      "NOT_A_ZIP",
      "Not a valid ZIP file (EOCD signature not found). Make sure you have selected an ELVIS ZIP.",
    );
  }

  const cdSize = tailView.getUint32(eocdPos + 12, true);
  const cdOffset = tailView.getUint32(eocdPos + 16, true); // absolute offset in file
  const cdCount = tailView.getUint16(eocdPos + 10, true);

  // cdOffset is absolute; our tailBytes start at: totalFileSize - tailBytes.length
  const tailStart = totalFileSize - tailBytes.length;
  if (cdOffset < tailStart || cdOffset + cdSize > totalFileSize) {
    throw new ElvisZipError(
      "TRUNCATED",
      "ZIP central directory is larger than the scan window. The file may be corrupted.",
    );
  }

  const cdRelStart = cdOffset - tailStart;
  if (cdRelStart + cdSize > tailBytes.length) {
    throw new ElvisZipError(
      "TRUNCATED",
      "ZIP central directory is larger than the scan window. The file may be corrupted.",
    );
  }

  const dec = new TextDecoder();
  const entries: ZipEntry[] = [];
  let pos = cdRelStart;

  for (let i = 0; i < cdCount; i++) {
    if (pos + 46 > cdRelStart + cdSize) break;
    if (tailView.getUint32(pos, true) !== 0x02014b50) break;

    const compressedSize = tailView.getUint32(pos + 20, true);
    const uncompressedSize = tailView.getUint32(pos + 24, true);
    const fnLen = tailView.getUint16(pos + 28, true);
    const extraLen = tailView.getUint16(pos + 30, true);
    const commentLen = tailView.getUint16(pos + 32, true);

    const filename = dec.decode(tailBytes.slice(pos + 46, pos + 46 + fnLen));
    entries.push({ filename, compressedSize, uncompressedSize });
    pos += 46 + fnLen + extraLen + commentLen;
  }

  return entries;
}

/**
 * Validates ZIP entries against worker requirements and returns stats.
 * Throws ElvisZipError with the same wording the topo worker would surface.
 * Worker source: topo/topo_mbtiles.py:401-457
 */
export function classifyElvisEntries(entries: ZipEntry[]): ElvisStats {
  if (entries.length === 0) {
    throw new ElvisZipError("EMPTY_ZIP", "The ZIP file contains no entries.");
  }

  let lazCount = 0;
  let demCount = 0;
  let derivativeTifCount = 0;
  let uncompressedBytes = 0;
  let compressedBytes = 0;
  const surveyNamesSet = new Set<string>();
  const tileIds = new Set<string>();
  const demResolutions = new Set<number>();

  for (const entry of entries) {
    uncompressedBytes += entry.uncompressedSize;
    compressedBytes += entry.compressedSize;

    const lower = entry.filename.toLowerCase();
    const basenameOrig = entry.filename.split("/").pop() ?? entry.filename;
    const stemLower = (basenameOrig.split("/").pop() ?? basenameOrig)
      .toLowerCase()
      .replace(/\.[^.]+$/, "");

    if (lower.endsWith(".laz") || lower.endsWith(".las")) {
      lazCount++;
      const stemOrig = basenameOrig.replace(/\.[^.]+$/, "");
      extractMeta(stemOrig, entry.filename, surveyNamesSet, tileIds, null, null);
    } else if (lower.endsWith(".tif") || lower.endsWith(".tiff")) {
      const isDerivative = DERIVATIVE_STEM_TOKENS.some((t) =>
        stemLower.includes(t),
      );
      if (isDerivative) {
        derivativeTifCount++;
      } else {
        demCount++;
        const stemOrig = basenameOrig.replace(/\.[^.]+$/, "");
        extractMeta(stemOrig, entry.filename, surveyNamesSet, tileIds, demResolutions, stemOrig);
      }
    }
  }

  if (lazCount === 0 && demCount === 0) {
    const derivativeNote =
      derivativeTifCount > 0
        ? ` (${derivativeTifCount} derivative raster${derivativeTifCount > 1 ? "s" : ""} such as hillshade were found but are not usable)`
        : "";
    throw new ElvisZipError(
      "NO_USABLE_FILES",
      `No usable files found in ZIP. Expected .laz/.las point clouds and/or .tif DEM rasters.${derivativeNote}`,
    );
  }

  let mode: ElvisStats["mode"];
  let modeLabel: string;
  if (lazCount > 0 && demCount > 0) {
    mode = "DEM_LAZ";
    modeLabel = "DEM + LiDAR (full output)";
  } else if (demCount > 0) {
    mode = "DEM_ONLY";
    modeLabel = "DEM only (no vegetation layer)";
  } else {
    mode = "LAZ_ONLY";
    modeLabel = "LiDAR only";
  }

  // Fall back to file count if no tile IDs parsed
  const tileCount = tileIds.size > 0 ? tileIds.size : lazCount + demCount;
  const demResolutionMeters =
    demResolutions.size === 1 ? [...demResolutions][0] : null;

  return {
    surveyNames: [...surveyNamesSet],
    mode,
    modeLabel,
    tileCount,
    lazCount,
    demCount,
    derivativeTifCount,
    demResolutionMeters,
    uncompressedBytes,
    compressedBytes,
  };
}

function extractMeta(
  stemOrig: string,
  fullPath: string,
  surveyNamesSet: Set<string>,
  tileIds: Set<string>,
  demResolutions: Set<number> | null,
  stemForRes: string | null,
): void {
  // ELVIS survey name: alphanumeric prefix before first non-alphanumeric char
  // e.g. "Katoomba201804-LID2-C3-AHD_..." → "Katoomba201804"
  const surveyMatch = stemOrig.match(/^([A-Za-z][A-Za-z0-9]+)/);
  if (surveyMatch) surveyNamesSet.add(surveyMatch[1]);

  // ELVIS tile ID pattern: _XXXXXXXX_ZZ_XXXX_XXXX
  const tileMatch = stemOrig.match(/_(\d+_\d+_\d+_\d+)/);
  if (tileMatch) tileIds.add(tileMatch[1]);

  // DEM resolution: "_2m." suffix or "2 Metre" directory component
  if (demResolutions !== null) {
    const resFromStem = stemForRes?.match(/[_\s](\d+(?:\.\d+)?)m$/i);
    const resFromPath = fullPath.match(/(\d+(?:\.\d+)?)\s+Metre/i);
    const res = resFromStem || resFromPath;
    if (res) demResolutions.add(parseFloat(res[1]));
  }
}
