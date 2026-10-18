// Cut a bbox out of a PMTiles v3 archive by byte range: what
// `pmtiles extract --bbox --minzoom --maxzoom` (go-pmtiles v1.31.2, its
// `extract.go`) does, in code both clients can run. Logjam GPS cuts each
// offline clip from the public archive on the CDN with it, so the area never
// reaches our API (docs/decisions/0036-the-phone-cuts-its-own-offline-clips.md).
//
// The output is the same tile set, tile bytes and header as go-pmtiles
// writes, with the same layout: header, root directory, metadata, leaf
// directories, then tile data. Guard: `pmtilesExtract.test.ts`, against
// go-pmtiles' own extracts of a fixture.
//
// PRIVACY: offsets and tile ids are the area. Nothing here logs, and no error
// carries either.

import { gzipSync } from "fflate";
import { PMTiles, zxyToTileId, type Source } from "pmtiles";

import { lonLatToTile, type RegionBbox } from "./mapRegionEstimate.js";

const HEADER_BYTES = 127;
/** The root directory has to end inside the first 16 KiB, which readers fetch in one go. */
const ROOT_BYTES = 16_384 - HEADER_BYTES;
const GZIP = 2;

/**
 * Bytes of unwanted tiles a request may read through to join the next run.
 * Each skipped gap trades a round trip for at most this many wasted bytes:
 * against the NSW archives the quickest on both a 4G and a 3G link, at up to
 * 12 % extra bytes (measured in the ADR above).
 */
export const EXTRACT_MERGE_GAP_BYTES = 64 * 1024;
/** A response is held in memory whole, so none is larger than this. */
export const EXTRACT_MAX_REQUEST_BYTES = 4 * 1024 * 1024;

type Entry = {
  tileId: number;
  offset: number;
  length: number;
  runLength: number;
};

/** One range request against the source, and where its bytes go. */
export type ExtractRequest = {
  /** Absolute byte offset in the source archive. */
  offset: number;
  length: number;
  /** Absolute offset in the output where the kept bytes start. */
  dstOffset: number;
  /** The runs of the response to keep, in order; the bytes between them are skipped tiles. */
  keep: { at: number; length: number }[];
};

export type ExtractPlan = {
  /** Header, root, metadata and leaf directories: the output's first bytes. */
  prefix: Uint8Array;
  /** In output order: each request's kept bytes start where the last one's ended. */
  requests: ExtractRequest[];
  /** The output's size in bytes. */
  totalBytes: number;
  /** The zooms it holds: those asked for, within the archive's. */
  minzoom: number;
  maxzoom: number;
  /**
   * The area misses the archive's bounds. The clip still holds the few
   * low-zoom tiles over both, as go-pmtiles' does, and nothing worth saving.
   */
  outside: boolean;
  /** The source's ETag when it sent one, so a range from a replaced archive is refused. */
  etag?: string;
};

export type ExtractOptions = {
  bbox: RegionBbox;
  /** Shallowest and deepest zoom kept; the archive's own when absent or beyond it. */
  minzoom?: number;
  maxzoom?: number;
  mergeGapBytes?: number;
  maxRequestBytes?: number;
};

/** The tile ids a bbox covers from minzoom to maxzoom, sorted. */
export function extractTileIds(
  bbox: RegionBbox,
  minzoom: number,
  maxzoom: number,
): number[] {
  // Covered at maxzoom and halved down, as go-pmtiles' generalizeOr does: a
  // parent is kept when any child is.
  const topLeft = lonLatToTile(bbox.west, bbox.north, maxzoom);
  const bottomRight = lonLatToTile(bbox.east, bbox.south, maxzoom);
  const ids: number[] = [];
  for (let z = minzoom; z <= maxzoom; z++) {
    const shift = 2 ** (maxzoom - z);
    for (
      let x = Math.floor(topLeft.x / shift);
      x <= Math.floor(bottomRight.x / shift);
      x++
    ) {
      for (
        let y = Math.floor(topLeft.y / shift);
        y <= Math.floor(bottomRight.y / shift);
        y++
      ) {
        ids.push(zxyToTileId(z, x, y));
      }
    }
  }
  return ids.sort((a, b) => a - b);
}

/** Index of the first id ≥ `value`. */
function lowerBound(ids: number[], value: number): number {
  let lo = 0;
  let hi = ids.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ids[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * The entries of one directory inside the wanted set, and the leaves that
 * hold any of it. A run of identical tiles is cut to the stretches inside the
 * set (go-pmtiles' RelevantEntries).
 */
function relevantEntries(
  dir: Entry[],
  ids: number[],
  lastTile: number,
): { tiles: Entry[]; leaves: Entry[] } {
  const tiles: Entry[] = [];
  const leaves: Entry[] = [];
  dir.forEach((entry, index) => {
    const end =
      entry.runLength === 0
        ? (dir[index + 1]?.tileId ?? lastTile)
        : entry.tileId + entry.runLength;
    let i = lowerBound(ids, entry.tileId);
    if (i >= ids.length || ids[i] >= end) return;
    if (entry.runLength === 0) {
      leaves.push(entry);
      return;
    }
    while (i < ids.length && ids[i] < end) {
      const start = ids[i];
      let run = 1;
      while (
        i + run < ids.length &&
        ids[i + run] === start + run &&
        start + run < end
      )
        run++;
      tiles.push({ ...entry, tileId: start, runLength: run });
      i += run;
    }
  });
  return { tiles, leaves };
}

function writeVarint(out: number[], value: number): void {
  // Arithmetic, not bit operators: ids and offsets pass 2^32.
  while (value >= 0x80) {
    out.push((value % 0x80) | 0x80);
    value = Math.floor(value / 0x80);
  }
  out.push(value);
}

function serializeEntries(entries: Entry[]): Uint8Array {
  const out: number[] = [];
  writeVarint(out, entries.length);
  let lastId = 0;
  for (const e of entries) {
    writeVarint(out, e.tileId - lastId);
    lastId = e.tileId;
  }
  for (const e of entries) writeVarint(out, e.runLength);
  for (const e of entries) writeVarint(out, e.length);
  entries.forEach((e, i) => {
    const prev = entries[i - 1];
    writeVarint(
      out,
      i > 0 && e.offset === prev.offset + prev.length ? 0 : e.offset + 1,
    );
  });
  // mtime 0: a replanned clip must reproduce its directories byte for byte,
  // which is how a partial file is known to be resumable.
  return gzipSync(Uint8Array.from(out), { level: 9, mtime: 0 });
}

/** go-pmtiles' BuildDirectories: everything in the root if it fits, else leaves. */
function buildDirectories(entries: Entry[]): {
  root: Uint8Array;
  leaves: Uint8Array;
} {
  if (entries.length < 16_384) {
    const root = serializeEntries(entries);
    if (root.length <= ROOT_BYTES) return { root, leaves: new Uint8Array(0) };
  }
  for (
    let leafSize = Math.max(4096, entries.length / 3500);
    ;
    leafSize *= 1.2
  ) {
    const size = Math.floor(leafSize);
    const rootEntries: Entry[] = [];
    const parts: Uint8Array[] = [];
    let leafBytes = 0;
    for (let i = 0; i < entries.length; i += size) {
      const leaf = serializeEntries(entries.slice(i, i + size));
      rootEntries.push({
        tileId: entries[i].tileId,
        offset: leafBytes,
        length: leaf.length,
        runLength: 0,
      });
      parts.push(leaf);
      leafBytes += leaf.length;
    }
    const root = serializeEntries(rootEntries);
    if (root.length <= ROOT_BYTES) return { root, leaves: concat(parts) };
  }
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Plan the extract: reads the header, the metadata and the leaves the area touches. */
export async function planExtract(
  source: Source,
  options: ExtractOptions,
): Promise<ExtractPlan> {
  const archive = new PMTiles(source);
  const header = await archive.getHeader();
  if (!header.clustered) throw new Error("The map archive isn't clustered");
  const minzoom = Math.max(options.minzoom ?? header.minZoom, header.minZoom);
  const maxzoom = Math.min(options.maxzoom ?? header.maxZoom, header.maxZoom);
  if (minzoom > maxzoom)
    throw new Error("The map archive has no tiles at those zooms");
  const gap = options.mergeGapBytes ?? EXTRACT_MERGE_GAP_BYTES;
  const maxRequest = options.maxRequestBytes ?? EXTRACT_MAX_REQUEST_BYTES;

  const ids = extractTileIds(options.bbox, minzoom, maxzoom);
  const lastTile = zxyToTileId(maxzoom + 1, 0, 0);
  const tiles: Entry[] = [];
  const walk = async (offset: number, length: number): Promise<void> => {
    const dir = await archive.cache.getDirectory(
      source,
      offset,
      length,
      header,
    );
    const found = relevantEntries(dir, ids, lastTile);
    tiles.push(...found.tiles);
    for (const leaf of found.leaves) {
      await walk(header.leafDirectoryOffset + leaf.offset, leaf.length);
    }
  };
  await walk(header.rootDirectoryOffset, header.rootDirectoryLength);
  tiles.sort((a, b) => a.tileId - b.tileId);

  // Re-encode into a contiguous tile section. A tile whose bytes another tile
  // already brought (deduplicated at source) points at the same copy.
  const seen = new Map<number, number>();
  const ranges: { src: number; dst: number; length: number }[] = [];
  const entries: Entry[] = [];
  let tileDataLength = 0;
  let addressedTiles = 0;
  for (const tile of tiles) {
    addressedTiles += tile.runLength;
    const copy = seen.get(tile.offset);
    if (copy !== undefined) {
      entries.push({ ...tile, offset: copy });
      continue;
    }
    const last = ranges[ranges.length - 1];
    if (last && last.src + last.length === tile.offset)
      last.length += tile.length;
    else
      ranges.push({
        src: tile.offset,
        dst: tileDataLength,
        length: tile.length,
      });
    entries.push({ ...tile, offset: tileDataLength });
    seen.set(tile.offset, tileDataLength);
    tileDataLength += tile.length;
  }

  const { root, leaves } = buildDirectories(entries);
  const metadata = new Uint8Array(
    (
      await source.getBytes(
        header.jsonMetadataOffset,
        header.jsonMetadataLength,
        undefined,
        header.etag,
      )
    ).data,
  );
  const metadataOffset = HEADER_BYTES + root.length;
  const leafOffset = metadataOffset + metadata.length;
  const tileDataOffset = leafOffset + leaves.length;

  const head = new DataView(new ArrayBuffer(HEADER_BYTES));
  const u64 = (at: number, value: number) => {
    head.setUint32(at, value % 2 ** 32, true);
    head.setUint32(at + 4, Math.floor(value / 2 ** 32), true);
  };
  // Go's int32(v * 1e7) truncates toward zero.
  const e7 = (at: number, value: number) =>
    head.setInt32(at, Math.trunc(value * 1e7), true);
  "PMTiles".split("").forEach((c, i) => head.setUint8(i, c.charCodeAt(0)));
  head.setUint8(7, 3);
  u64(8, HEADER_BYTES);
  u64(16, root.length);
  u64(24, metadataOffset);
  u64(32, metadata.length);
  u64(40, leafOffset);
  u64(48, leaves.length);
  u64(56, tileDataOffset);
  u64(64, tileDataLength);
  u64(72, addressedTiles);
  u64(80, tiles.length);
  u64(88, seen.size);
  head.setUint8(96, 1);
  head.setUint8(97, GZIP);
  head.setUint8(98, header.tileCompression);
  head.setUint8(99, header.tileType);
  head.setUint8(100, minzoom);
  head.setUint8(101, maxzoom);
  const { west, south, east, north } = options.bbox;
  e7(102, west);
  e7(106, south);
  e7(110, east);
  e7(114, north);
  head.setUint8(118, Math.min(Math.max(header.centerZoom, minzoom), maxzoom));
  e7(119, (west + east) / 2);
  e7(123, (south + north) / 2);

  // Coalesce: Hilbert order keeps an area in long runs, so most gaps between
  // them are a few tiles of somewhere else, cheaper to read through than to
  // ask for separately.
  const requests: ExtractRequest[] = [];
  for (const range of ranges) {
    for (let done = 0; done < range.length; done += maxRequest) {
      const src = header.tileDataOffset + range.src + done;
      const length = Math.min(maxRequest, range.length - done);
      const dst = tileDataOffset + range.dst + done;
      const last = requests[requests.length - 1];
      const end = last ? last.offset + last.length : 0;
      if (
        last &&
        src >= end &&
        src - end <= gap &&
        src + length - last.offset <= maxRequest
      ) {
        last.keep.push({ at: src - last.offset, length });
        last.length = src + length - last.offset;
      } else {
        requests.push({
          offset: src,
          length,
          dstOffset: dst,
          keep: [{ at: 0, length }],
        });
      }
    }
  }

  return {
    prefix: concat([new Uint8Array(head.buffer), root, metadata, leaves]),
    requests,
    totalBytes: tileDataOffset + tileDataLength,
    minzoom,
    maxzoom,
    outside:
      west > header.maxLon ||
      east < header.minLon ||
      south > header.maxLat ||
      north < header.minLat,
    etag: header.etag,
  };
}

/** Fetch one request; the bytes it returns belong at `request.dstOffset`. */
export async function fetchExtractRequest(
  source: Source,
  plan: Pick<ExtractPlan, "etag">,
  request: ExtractRequest,
): Promise<Uint8Array> {
  const { data } = await source.getBytes(
    request.offset,
    request.length,
    undefined,
    plan.etag,
  );
  if (data.byteLength !== request.length)
    throw new Error("The map archive sent a short range");
  const bytes = new Uint8Array(data);
  if (request.keep.length === 1)
    return bytes.subarray(0, request.keep[0].length);
  return concat(
    request.keep.map(({ at, length }) => bytes.subarray(at, at + length)),
  );
}
