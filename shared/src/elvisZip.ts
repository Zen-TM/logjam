export type ElvisZipErrorCode =
  | "NOT_A_ZIP"
  | "TRUNCATED"
  | "NO_USABLE_FILES"
  | "EMPTY_ZIP"
  | "UNSAFE_PATH"
  | "TOO_MANY_FILES"
  | "ONLY_5M";

/**
 * Rejects ZIP entry names that would escape the extraction directory
 * (zip-slip). Mirrors the worker-side guard in topo/pipeline.py
 * (_safe_extract_zip) so the API pre-check blocks a malicious upload before
 * ECS spin-up. Returns true if the name is unsafe.
 */
export function isUnsafeZipEntryName(filename: string): boolean {
  if (filename.startsWith("/") || filename.startsWith("\\")) return true;
  // Windows drive-absolute path, e.g. "C:\\evil" or "C:/evil".
  if (/^[A-Za-z]:[/\\]/.test(filename)) return true;
  const parts = filename.replace(/\\/g, "/").split("/");
  return parts.includes("..");
}

/**
 * Human-friendly region name from an ELVIS survey name: the leading
 * alphabetic prefix, dropping the trailing numeric survey code.
 * e.g. "Katoomba201804" → "Katoomba". Falls back to the full survey name
 * when there is no alphabetic prefix.
 */
export function regionNameFromSurvey(survey: string): string {
  return survey.match(/^[A-Za-z]+/)?.[0] ?? survey;
}

import { say, type UserSentence } from "./userSentence.js";

const NOT_A_ZIP = say`That file isn't a ZIP. Choose the ZIP that ELVIS sent you.`;
const TRUNCATED = say`Logjam couldn't read that ZIP. It may be damaged, so download it from ELVIS again.`;
const TOO_MANY_FILES = say`That ZIP lists more files than Logjam can check. Choose a smaller area in ELVIS.`;
const NO_USABLE_FILES = say`That ZIP has no point clouds or elevation rasters in it.`;
/** topo/sharpen.py's ONLY_5M, word for word (elvisZip.test.ts holds them equal). */
const ONLY_5M = say`This ZIP holds only 5 m DEMs, which Logjam already has for all of NSW. Choose the 1 m or 2 m DEM, or the point clouds, in ELVIS.`;
/**
 * The coarsest DEM cell a sharpened job uses as ground (sharpen.py
 * `zoom_for_cell`; elvisZip.test.ts holds them equal).
 */
const SHARPEN_MAX_DEM_CELL_M = 3;

export class ElvisZipError extends Error {
  code: ElvisZipErrorCode;
  /** What the person who chose the ZIP reads, on Logjam Web and from the API. */
  sentence: UserSentence;
  constructor(code: ElvisZipErrorCode, sentence: UserSentence) {
    super(sentence);
    this.name = "ElvisZipError";
    this.code = code;
    this.sentence = sentence;
  }
}

export interface ZipEntry {
  filename: string;
  compressedSize: number;
  uncompressedSize: number;
}

export interface ElvisStats {
  surveyNames: string[];
  mode: "DEM_ONLY" | "LAZ_ONLY";
  modeLabel: string;
  tileCount: number;
  lazCount: number;
  demCount: number;
  derivativeTifCount: number;
  demResolutionMeters: number | null;
  uncompressedBytes: number;
  compressedBytes: number;
  // True when the ZIP carries more than one point-cloud survey for the same
  // ground footprint (LAZ mode only — the mode where the worker resolves
  // overlap). The worker then auto-picks per layer: the densest survey for
  // terrain (hillshade/slope/contours), the most-recent for vegetation — see
  // topo/pipeline.py select_surveys_by_layer. tileCount already counts distinct
  // footprints, so overlap does NOT consume extra tile quota.
  overlappingSurveys: boolean;
}

// Matches topo/pipeline.py derivative filter (case-insensitive stem contains any of these)
export const DERIVATIVE_STEM_TOKENS = [
  "hillshade",
  "slope",
  "aspect",
  "colour",
  "color",
  "rgb",
] as const;

/** How much of a ZIP's end `readZipEntries` reads first. */
export const ZIP_TAIL_BYTES = 65536;

/**
 * The most central directory `readZipEntries` will fetch. The directory is
 * attacker-controlled on the API, so its size is bounded before it is read;
 * 16 MiB is about 100,000 ELVIS entries, far past any real download
 * (elvisZip.test.ts holds the refusal).
 */
export const MAX_ZIP_DIRECTORY_BYTES = 16 * 1024 * 1024;

const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const CENTRAL_ENTRY_SIGNATURE = 0x02014b50;
const ZIP64_EXTRA_ID = 0x0001;
const EOCD_BYTES = 22;
const ZIP64_LOCATOR_BYTES = 20;
const ZIP64_EOCD_BYTES = 56;
const CENTRAL_ENTRY_BYTES = 46;
const SATURATED_16 = 0xffff;
const SATURATED_32 = 0xffffffff;

/** Where a ZIP's central directory is, in absolute file offsets. */
export interface ZipDirectoryLocation {
  offset: number;
  size: number;
  count: number;
}

/** A 64-bit little-endian field as a number; a value past 2^53 is not a real ZIP. */
function readUint64(view: DataView, pos: number): number {
  const high = view.getUint32(pos + 4, true);
  if (high > 0x1fffff) throw new ElvisZipError("TRUNCATED", TRUNCATED);
  return high * 2 ** 32 + view.getUint32(pos, true);
}

/**
 * Finds the central directory from the trailing bytes of a ZIP: the classic
 * end record, or the Zip64 one when the classic fields are saturated
 * (APPNOTE 4.3.14 to 4.3.16). Does not need the directory itself.
 *
 * `tailBytes` is the last N bytes of the file and `totalFileSize` its size.
 * Throws ElvisZipError if the data is not a ZIP or a record points outside the
 * file.
 */
export function locateZipCentralDirectory(
  tailBytes: Uint8Array,
  totalFileSize: number,
): ZipDirectoryLocation {
  if (tailBytes.length < EOCD_BYTES) {
    throw new ElvisZipError("NOT_A_ZIP", NOT_A_ZIP);
  }

  // Search backward for EOCD signature — handles zip comments up to tail length
  const view = new DataView(
    tailBytes.buffer,
    tailBytes.byteOffset,
    tailBytes.byteLength,
  );
  let eocdPos = -1;
  for (let i = tailBytes.length - EOCD_BYTES; i >= 0; i--) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) {
      eocdPos = i;
      break;
    }
  }
  if (eocdPos === -1) {
    throw new ElvisZipError("NOT_A_ZIP", NOT_A_ZIP);
  }

  let count = view.getUint16(eocdPos + 10, true);
  let size = view.getUint32(eocdPos + 12, true);
  let offset = view.getUint32(eocdPos + 16, true);

  const tailStart = totalFileSize - tailBytes.length;
  const saturated =
    count === SATURATED_16 || size === SATURATED_32 || offset === SATURATED_32;
  const locatorPos = eocdPos - ZIP64_LOCATOR_BYTES;
  if (
    saturated &&
    locatorPos >= 0 &&
    view.getUint32(locatorPos, true) === ZIP64_LOCATOR_SIGNATURE
  ) {
    // The Zip64 end record sits just before its locator; one that starts
    // before the tail we were given is refused rather than guessed at.
    const recordPos = readUint64(view, locatorPos + 8) - tailStart;
    if (
      recordPos < 0 ||
      recordPos + ZIP64_EOCD_BYTES > tailBytes.length ||
      view.getUint32(recordPos, true) !== ZIP64_EOCD_SIGNATURE
    ) {
      throw new ElvisZipError("TRUNCATED", TRUNCATED);
    }
    count = readUint64(view, recordPos + 32);
    size = readUint64(view, recordPos + 40);
    offset = readUint64(view, recordPos + 48);
  }

  if (offset + size > totalFileSize) {
    throw new ElvisZipError("TRUNCATED", TRUNCATED);
  }
  return { offset, size, count };
}

/**
 * Reads `location.count` entries from the central directory bytes.
 * An entry size of 0xFFFFFFFF is the real value in the entry's Zip64 extra
 * field (APPNOTE 4.5.3), uncompressed size first.
 */
function parseDirectoryEntries(
  directory: Uint8Array,
  count: number,
): ZipEntry[] {
  const view = new DataView(
    directory.buffer,
    directory.byteOffset,
    directory.byteLength,
  );
  const dec = new TextDecoder();
  const entries: ZipEntry[] = [];
  let pos = 0;

  for (let i = 0; i < count; i++) {
    if (
      pos + CENTRAL_ENTRY_BYTES > directory.length ||
      view.getUint32(pos, true) !== CENTRAL_ENTRY_SIGNATURE
    ) {
      throw new ElvisZipError("TRUNCATED", TRUNCATED);
    }

    let compressedSize = view.getUint32(pos + 20, true);
    let uncompressedSize = view.getUint32(pos + 24, true);
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const nameEnd = pos + CENTRAL_ENTRY_BYTES + nameLen;
    const entryEnd = nameEnd + extraLen + commentLen;
    if (entryEnd > directory.length) {
      throw new ElvisZipError("TRUNCATED", TRUNCATED);
    }

    if (uncompressedSize === SATURATED_32 || compressedSize === SATURATED_32) {
      let found = false;
      const extraEnd = nameEnd + extraLen;
      for (let x = nameEnd; x + 4 <= extraEnd; ) {
        const id = view.getUint16(x, true);
        const length = view.getUint16(x + 2, true);
        const data = x + 4;
        x = data + length;
        if (x > extraEnd) throw new ElvisZipError("TRUNCATED", TRUNCATED);
        if (id !== ZIP64_EXTRA_ID) continue;
        let at = data;
        const take = () => {
          if (at + 8 > data + length) {
            throw new ElvisZipError("TRUNCATED", TRUNCATED);
          }
          at += 8;
          return readUint64(view, at - 8);
        };
        if (uncompressedSize === SATURATED_32) uncompressedSize = take();
        if (compressedSize === SATURATED_32) compressedSize = take();
        found = true;
        break;
      }
      if (!found) throw new ElvisZipError("TRUNCATED", TRUNCATED);
    }

    const filename = dec.decode(
      directory.subarray(pos + CENTRAL_ENTRY_BYTES, nameEnd),
    );
    entries.push({ filename, compressedSize, uncompressedSize });
    pos = entryEnd;
  }

  return entries;
}

/**
 * Parses the ZIP central directory when it lies wholly inside `tailBytes`,
 * the last N bytes of the file. A directory that starts earlier throws
 * TRUNCATED; `readZipEntries` is the form that fetches it.
 */
export function parseZipCentralDirectory(
  tailBytes: Uint8Array,
  totalFileSize: number,
): ZipEntry[] {
  const { offset, size, count } = locateZipCentralDirectory(
    tailBytes,
    totalFileSize,
  );
  const start = offset - (totalFileSize - tailBytes.length);
  if (start < 0) throw new ElvisZipError("TRUNCATED", TRUNCATED);
  return parseDirectoryEntries(tailBytes.subarray(start, start + size), count);
}

/**
 * The entries of a ZIP of `totalFileSize` bytes, reading it through
 * `readRange(start, end)` (end exclusive; an S3 ranged GET or `File.slice`).
 * Reads the last `ZIP_TAIL_BYTES` first and, if the central directory starts
 * before them, one more range of at most `MAX_ZIP_DIRECTORY_BYTES`.
 */
export async function readZipEntries(
  totalFileSize: number,
  readRange: (start: number, end: number) => Promise<Uint8Array>,
): Promise<ZipEntry[]> {
  if (totalFileSize < EOCD_BYTES) {
    throw new ElvisZipError("NOT_A_ZIP", NOT_A_ZIP);
  }
  const read = async (start: number, end: number) => {
    const bytes = await readRange(start, end);
    if (bytes.length !== end - start) {
      throw new ElvisZipError("TRUNCATED", TRUNCATED);
    }
    return bytes;
  };

  const tailStart = Math.max(0, totalFileSize - ZIP_TAIL_BYTES);
  const tail = await read(tailStart, totalFileSize);
  const { offset, size, count } = locateZipCentralDirectory(
    tail,
    totalFileSize,
  );
  if (offset >= tailStart) {
    const start = offset - tailStart;
    return parseDirectoryEntries(tail.subarray(start, start + size), count);
  }
  if (size > MAX_ZIP_DIRECTORY_BYTES) {
    throw new ElvisZipError("TOO_MANY_FILES", TOO_MANY_FILES);
  }
  return parseDirectoryEntries(await read(offset, offset + size), count);
}

/**
 * Validates ZIP entries against worker requirements and returns stats.
 * Throws ElvisZipError with the same wording the topo worker would surface.
 * Worker source: topo/sharpen.py `dem_plan`.
 */
export function classifyElvisEntries(entries: ZipEntry[]): ElvisStats {
  if (entries.length === 0) {
    throw new ElvisZipError("EMPTY_ZIP", say`That ZIP is empty.`);
  }

  let lazCount = 0;
  let demCount = 0;
  let derivativeTifCount = 0;
  let uncompressedBytes = 0;
  let compressedBytes = 0;
  const surveyNamesSet = new Set<string>();
  const tileIds = new Set<string>();
  const demResolutions = new Set<number>();
  // Whether any DEM could be a sharpened job's ground: no coarser than
  // SHARPEN_MAX_DEM_CELL_M, or of a cell its name doesn't say (the worker
  // reads that from the file).
  let groundDem = false;
  // Point-cloud files per footprint id — >1 means overlapping surveys the
  // worker will have to choose between (LAZ mode).
  const lazTileFileCounts = new Map<string, number>();

  for (const entry of entries) {
    if (isUnsafeZipEntryName(entry.filename)) {
      throw new ElvisZipError(
        "UNSAFE_PATH",
        say`That ZIP has a file path Logjam won't open. Download it from ELVIS again.`,
      );
    }
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
      const tileId = extractMeta(
        stemOrig,
        entry.filename,
        surveyNamesSet,
        tileIds,
        null,
        null,
      );
      if (tileId) {
        lazTileFileCounts.set(tileId, (lazTileFileCounts.get(tileId) ?? 0) + 1);
      }
    } else if (lower.endsWith(".tif") || lower.endsWith(".tiff")) {
      const isDerivative = DERIVATIVE_STEM_TOKENS.some((t) =>
        stemLower.includes(t),
      );
      if (isDerivative) {
        derivativeTifCount++;
      } else {
        demCount++;
        const stemOrig = basenameOrig.replace(/\.[^.]+$/, "");
        const resolutions = new Set<number>();
        extractMeta(
          stemOrig,
          entry.filename,
          surveyNamesSet,
          tileIds,
          resolutions,
          stemOrig,
        );
        for (const metres of resolutions) demResolutions.add(metres);
        const [metres] = resolutions;
        if (metres === undefined || metres <= SHARPEN_MAX_DEM_CELL_M)
          groundDem = true;
      }
    }
  }

  if (lazCount === 0 && demCount === 0) {
    throw new ElvisZipError(
      "NO_USABLE_FILES",
      derivativeTifCount === 0
        ? NO_USABLE_FILES
        : derivativeTifCount === 1
          ? say`${NO_USABLE_FILES} It has 1 derivative raster, such as a hillshade, which Logjam can't use.`
          : say`${NO_USABLE_FILES} It has ${derivativeTifCount} derivative rasters, such as hillshades, which Logjam can't use.`,
    );
  }

  // A sharpened job grounds on a DEM no coarser than SHARPEN_MAX_DEM_CELL_M,
  // else on the point clouds, and a ZIP with neither adds nothing to the
  // statewide 5 m data (topo/sharpen.py `dem_plan`). Said before the upload,
  // as the worker would.
  if (lazCount === 0 && !groundDem) {
    throw new ElvisZipError("ONLY_5M", ONLY_5M);
  }

  const mode: ElvisStats["mode"] = lazCount > 0 ? "LAZ_ONLY" : "DEM_ONLY";
  // Vegetation is the form's own choice, so the label says only the ground.
  const modeLabel = groundDem
    ? "Ground from the DEM"
    : "Ground from the point clouds";

  // Fall back to file count if no tile IDs parsed
  const tileCount = tileIds.size > 0 ? tileIds.size : lazCount + demCount;
  const demResolutionMeters =
    demResolutions.size === 1 ? [...demResolutions][0] : null;

  // Overlap is in the point clouds: any footprint with >1 point-cloud file
  // means two surveys cover the same ground.
  const overlappingSurveys =
    mode === "LAZ_ONLY" &&
    [...lazTileFileCounts.values()].some((count) => count > 1);

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
    overlappingSurveys,
  };
}

/** Returns the parsed footprint tile id (or null if the name doesn't match). */
function extractMeta(
  stemOrig: string,
  fullPath: string,
  surveyNamesSet: Set<string>,
  tileIds: Set<string>,
  demResolutions: Set<number> | null,
  stemForRes: string | null,
): string | null {
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

  return tileMatch ? tileMatch[1] : null;
}
