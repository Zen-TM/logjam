import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, it, expect } from "vitest";
import {
  parseZipCentralDirectory,
  readZipEntries,
  MAX_ZIP_DIRECTORY_BYTES,
  ZIP_TAIL_BYTES,
  classifyElvisEntries,
  ElvisZipError,
  isUnsafeZipEntryName,
  regionNameFromSurvey,
} from "./elvisZip";

// ── Helpers ───────────────────────────────────────────────────────────────────

interface TestFile {
  name: string;
  size?: number; // uncompressed size, defaults to 0
}

/** Builds a minimal stored ZIP (no compression) from a list of filenames. */
function buildZip(files: TestFile[]): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let localOffset = 0;

  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const dataSize = f.size ?? 0;

    const local = new Uint8Array(30 + nameBytes.length + dataSize);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint32(18, dataSize, true);
    lv.setUint32(22, dataSize, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    locals.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint32(20, dataSize, true);
    cv.setUint32(24, dataSize, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, localOffset, true);
    central.set(nameBytes, 46);
    centrals.push(central);

    localOffset += local.length;
  }

  const cdOffset = localOffset;
  const cdSize = centrals.reduce((s, c) => s + c.length, 0);

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, cdOffset, true);

  const parts = [...locals, ...centrals, eocd];
  const total = parts.reduce((s, p) => s + p.length, 0);
  const zip = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) {
    zip.set(p, pos);
    pos += p.length;
  }
  return zip;
}

function parse(zip: Uint8Array) {
  return parseZipCentralDirectory(zip, zip.length);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("parseZipCentralDirectory", () => {
  it("parses entries from a valid zip", () => {
    const zip = buildZip([
      { name: "folder/file.laz", size: 1000 },
      { name: "folder/file.tif", size: 500 },
    ]);
    const entries = parse(zip);
    expect(entries).toHaveLength(2);
    expect(entries[0].filename).toBe("folder/file.laz");
    expect(entries[0].uncompressedSize).toBe(1000);
    expect(entries[1].filename).toBe("folder/file.tif");
  });

  it("throws NOT_A_ZIP on random bytes", () => {
    const junk = new Uint8Array(100);
    junk.fill(0xab);
    expect(() => parse(junk)).toThrow(ElvisZipError);
    expect(() => parse(junk)).toThrowError(
      expect.objectContaining({ code: "NOT_A_ZIP" }),
    );
  });

  it("throws NOT_A_ZIP on too-small buffer", () => {
    expect(() => parseZipCentralDirectory(new Uint8Array(10), 10)).toThrow(
      ElvisZipError,
    );
  });

  it("handles empty zip (no entries)", () => {
    const zip = buildZip([]);
    const entries = parse(zip);
    expect(entries).toHaveLength(0);
  });
});

// Real Python `zipfile` output (made-up names, no data). Python only writes the
// Zip64 records when a size or offset passes 4 GiB, so each fixture is the
// structure Python wrote for one: a 6 GiB entry in a small archive, and the
// tail of an archive whose central directory starts at 4,718,592,530.
const PYTHON_BIG_ENTRY_ZIP = fromBase64(
  "UEsDBBQAAAAAAIBkbV0AAAAAAAAAAAAAAAAnAAAATWFkZXVwMjAxODAxL2FfMjQwMDAwNF81Nl8wMDAxXzAwMDEubGF6UEsDBBQAAAAAAIBkbV0AAAAAAAAAAAAAAAAnAAAATWFkZXVwMjAxODAxL2FfMjQwMDAwNF81Nl8wMDAxXzAwMDIubGF6UEsBAi0DLQAAAAAAgGRtXQAAAAD//////////ycAFAAAAAAAAAAAAIABAAAAAE1hZGV1cDIwMTgwMS9hXzI0MDAwMDRfNTZfMDAwMV8wMDAxLmxhegEAEAAAAACAAQAAAAAAAMAAAAAAUEsBAhQDFAAAAAAAgGRtXQAAAAAAAAAAAAAAACcAAAAAAAAAAAAAAIABRQAAAE1hZGV1cDIwMTgwMS9hXzI0MDAwMDRfNTZfMDAwMV8wMDAyLmxhelBLBQYAAAAAAgACAL4AAACKAAAAAAA=",
);
const PYTHON_ZIP64_TAIL = fromBase64(
  "UEsBAi0DLQAAAAAAAAAhAL5SE/D//////////0sAFAAAAAAAAAAAAIABAAAAAE1hZGV1cDIwMTgwMS9Qb2ludCBDbG91ZHMvTWFkZXVwMjAxODAxLUxJRDItQzMtQUhEXzI0MDAwMDRfNTZfMDAwMV8wMDAxLmxhegEAEAAAAEAZAQAAAAAAQBkBAAAAUEsBAi0DLQAAAAAAAAAhAHdH344KAAAACgAAAEsADAAAAAAAAAAAAIAB/////01hZGV1cDIwMTgwMS9Qb2ludCBDbG91ZHMvTWFkZXVwMjAxODAxLUxJRDItQzMtQUhEXzI0MDAwMDRfNTZfMDAwMV8wMDAyLmxhegEACAB9AEAZAQAAAFBLAQItAy0AAAAAAAAAIQB3R9+OCgAAAAoAAABLAAwAAAAAAAAAAACAAf////9NYWRldXAyMDE4MDEvUG9pbnQgQ2xvdWRzL01hZGV1cDIwMTgwMS1MSUQyLUMzLUFIRF8yNDAwMDA0XzU2XzAwMDFfMDAwMy5sYXoBAAgABAFAGQEAAABQSwECLQMtAAAAAAAAACEAd0ffjgoAAAAKAAAASwAMAAAAAAAAAAAAgAH/////TWFkZXVwMjAxODAxL1BvaW50IENsb3Vkcy9NYWRldXAyMDE4MDEtTElEMi1DMy1BSERfMjQwMDAwNF81Nl8wMDAxXzAwMDQubGF6AQAIAIsBQBkBAAAAUEsGBiwAAAAAAAAALQAtAAAAAAAAAAAABAAAAAAAAAAEAAAAAAAAABwCAAAAAAAAEgJAGQEAAABQSwYHAAAAAC4EQBkBAAAAAQAAAFBLBQYAAAAABAAEABwCAAD/////AAA=",
);
const PYTHON_ZIP64_TAIL_FILE_SIZE = 4718593168;

function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(Buffer.from(text, "base64"));
}

describe("parseZipCentralDirectory on Zip64 archives", () => {
  it("reads an entry of 4 GiB or more from the Zip64 extra field", () => {
    const entries = parse(PYTHON_BIG_ENTRY_ZIP);
    expect(entries.map((e) => e.filename)).toEqual([
      "Madeup201801/a_2400004_56_0001_0001.laz",
      "Madeup201801/a_2400004_56_0001_0002.laz",
    ]);
    expect(entries[0].uncompressedSize).toBe(6 * 2 ** 30);
    expect(entries[0].compressedSize).toBe(3 * 2 ** 30);
    expect(entries[1].uncompressedSize).toBe(0);
  });

  it("reads a directory that starts past 4 GiB", () => {
    const entries = parseZipCentralDirectory(
      PYTHON_ZIP64_TAIL,
      PYTHON_ZIP64_TAIL_FILE_SIZE,
    );
    expect(entries).toHaveLength(4);
    expect(entries[0].uncompressedSize).toBe(4_718_592_000);
    expect(entries[0].compressedSize).toBe(4_718_592_000);
    // The next three declare only a header offset in their Zip64 extra field,
    // so their real sizes sit in the classic fields and must not be skipped.
    expect(entries.slice(1).map((e) => e.uncompressedSize)).toEqual([
      10, 10, 10,
    ]);
  });
});

// A file's bytes as `readRange` serves them: only what is held, the rest zeros.
function virtualFile(
  totalFileSize: number,
  held: { at: number; bytes: Uint8Array }[],
) {
  const reads: [number, number][] = [];
  const readRange = async (start: number, end: number) => {
    reads.push([start, end]);
    const out = new Uint8Array(end - start);
    for (const { at, bytes } of held) {
      const from = Math.max(start, at);
      const to = Math.min(end, at + bytes.length);
      if (from < to) out.set(bytes.subarray(from - at, to - at), from - start);
    }
    return out;
  };
  return { totalFileSize, readRange, reads };
}

/** The central directory bytes of buildZip's output. */
function directoryOf(zip: Uint8Array): Uint8Array {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const size = view.getUint32(zip.length - 22 + 12, true);
  const offset = view.getUint32(zip.length - 22 + 16, true);
  return zip.subarray(offset, offset + size);
}

/**
 * APPNOTE 4.3.14 to 4.3.16 around a directory: the Zip64 end record, its
 * locator, then an end record with every field saturated. The sizes in the
 * directory's own entries stay as they are. Same layout as the Python tail.
 */
function zip64Tail(
  directory: Uint8Array,
  count: number,
  directoryOffset: number,
): Uint8Array {
  const tail = new Uint8Array(directory.length + 56 + 20 + 22);
  tail.set(directory);
  const view = new DataView(tail.buffer);
  const record = directory.length;
  view.setUint32(record, 0x06064b50, true);
  view.setBigUint64(record + 4, 44n, true);
  view.setUint16(record + 12, 45, true);
  view.setUint16(record + 14, 45, true);
  view.setBigUint64(record + 24, BigInt(count), true);
  view.setBigUint64(record + 32, BigInt(count), true);
  view.setBigUint64(record + 40, BigInt(directory.length), true);
  view.setBigUint64(record + 48, BigInt(directoryOffset), true);
  const locator = record + 56;
  view.setUint32(locator, 0x07064b50, true);
  view.setBigUint64(locator + 8, BigInt(directoryOffset + record), true);
  view.setUint32(locator + 16, 1, true);
  const eocd = locator + 20;
  view.setUint32(eocd, 0x06054b50, true);
  view.setUint16(eocd + 8, 0xffff, true);
  view.setUint16(eocd + 10, 0xffff, true);
  view.setUint32(eocd + 12, 0xffffffff, true);
  view.setUint32(eocd + 16, 0xffffffff, true);
  return tail;
}

const elvisNames = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    name: `Madeup201801/Point Clouds/Madeup201801-LID2-C3-AHD_${2400000 + i}_56_${String(i).padStart(4, "0")}_0001.laz`,
  }));

describe("readZipEntries", () => {
  it("reads a directory larger than the tail with one more read", async () => {
    // Mutation: return the tail's entries without the second read, or make
    // locateZipCentralDirectory throw when the directory starts before the tail.
    const zip = buildZip(elvisNames(1200));
    const directory = directoryOf(zip);
    expect(directory.length).toBeGreaterThan(ZIP_TAIL_BYTES);
    const file = virtualFile(zip.length, [{ at: 0, bytes: zip }]);
    const entries = await readZipEntries(file.totalFileSize, file.readRange);
    expect(entries).toHaveLength(1200);
    expect(entries[1199].filename).toBe(elvisNames(1200)[1199].name);
    expect(file.reads).toEqual([
      [zip.length - ZIP_TAIL_BYTES, zip.length],
      [zip.length - 22 - directory.length, zip.length - 22],
    ]);
  });

  it("reads a small zip with the tail alone", async () => {
    const zip = buildZip(elvisNames(3));
    const file = virtualFile(zip.length, [{ at: 0, bytes: zip }]);
    expect(await readZipEntries(zip.length, file.readRange)).toHaveLength(3);
    expect(file.reads).toEqual([[0, zip.length]]);
  });

  it("reads a Zip64 directory at 5 GiB that is larger than the tail", async () => {
    const directory = directoryOf(buildZip(elvisNames(1200)));
    const at = 5 * 2 ** 30;
    const tail = zip64Tail(directory, 1200, at);
    const file = virtualFile(at + tail.length, [{ at, bytes: tail }]);
    const entries = await readZipEntries(file.totalFileSize, file.readRange);
    expect(entries).toHaveLength(1200);
    expect(file.reads[1]).toEqual([at, at + directory.length]);
  });

  it("reads a real Python Zip64 archive whose directory starts past 4 GiB", async () => {
    const file = virtualFile(PYTHON_ZIP64_TAIL_FILE_SIZE, [
      {
        at: PYTHON_ZIP64_TAIL_FILE_SIZE - PYTHON_ZIP64_TAIL.length,
        bytes: PYTHON_ZIP64_TAIL,
      },
    ]);
    const entries = await readZipEntries(file.totalFileSize, file.readRange);
    expect(entries).toHaveLength(4);
    expect(classifyElvisEntries(entries).uncompressedBytes).toBe(
      4_718_592_000 + 30,
    );
    expect(file.reads).toHaveLength(1);
  });

  it("refuses a directory over the cap without fetching it", async () => {
    // Mutation: delete the MAX_ZIP_DIRECTORY_BYTES check in readZipEntries.
    const at = 5 * 2 ** 30;
    const size = MAX_ZIP_DIRECTORY_BYTES + 1;
    // An empty directory's records, then the size and the locator moved out
    // to where a directory of `size` bytes would end.
    const tail = zip64Tail(new Uint8Array(0), 0, at);
    const view = new DataView(tail.buffer);
    view.setBigUint64(40, BigInt(size), true);
    view.setBigUint64(56 + 8, BigInt(at + size), true);
    const file = virtualFile(at + size + tail.length, [
      { at: at + size, bytes: tail },
    ]);
    await expect(
      readZipEntries(file.totalFileSize, file.readRange),
    ).rejects.toMatchObject({ code: "TOO_MANY_FILES" });
    expect(file.reads).toHaveLength(1);
  });

  it("is NOT_A_ZIP for a file shorter than an end record, without reading", async () => {
    const file = virtualFile(10, []);
    await expect(readZipEntries(10, file.readRange)).rejects.toMatchObject({
      code: "NOT_A_ZIP",
    });
    expect(file.reads).toHaveLength(0);
  });

  it("is TRUNCATED when a read comes back short", async () => {
    // Mutation: drop the length check on a read.
    const zip = buildZip(elvisNames(1200));
    await expect(
      readZipEntries(zip.length, async (start, end) =>
        zip.slice(start, end - 1),
      ),
    ).rejects.toMatchObject({ code: "TRUNCATED" });
  });
});

describe("a lying Zip64 record is refused, never crashes", () => {
  /** PYTHON_ZIP64_TAIL with `patch` applied; offsets are from the tail's end. */
  function lie(
    patch: (view: DataView, record: number, locator: number) => void,
  ) {
    const tail = PYTHON_ZIP64_TAIL.slice();
    patch(
      new DataView(tail.buffer),
      tail.length - 22 - 20 - 56,
      tail.length - 22 - 20,
    );
    return () => parseZipCentralDirectory(tail, PYTHON_ZIP64_TAIL_FILE_SIZE);
  }
  const refused = (code: string) => expect.objectContaining({ code });

  it("takes the count from the Zip64 record when the classic count is saturated", () => {
    // Mutation: read the count from the classic record only.
    const run = lie((view) => {
      const eocd = PYTHON_ZIP64_TAIL.length - 22;
      view.setUint16(eocd + 10, 0xffff, true);
      view.setUint16(eocd + 8, 0xffff, true);
    });
    expect(run()).toHaveLength(4);
  });

  it("refuses a locator that points outside the file", () => {
    // Mutation: use the locator's offset without checking it is in the tail.
    expect(
      lie((view, _record, locator) =>
        view.setBigUint64(
          locator + 8,
          BigInt(PYTHON_ZIP64_TAIL_FILE_SIZE),
          true,
        ),
      ),
    ).toThrow(refused("TRUNCATED"));
    expect(
      lie((view, _record, locator) => view.setBigUint64(locator + 8, 0n, true)),
    ).toThrow(refused("TRUNCATED"));
  });

  it("refuses a locator that points at something else", () => {
    // Mutation: skip the Zip64 end record's signature check.
    expect(lie((view, record) => view.setUint32(record, 0, true))).toThrow(
      refused("TRUNCATED"),
    );
  });

  it("refuses a directory that ends past the file", () => {
    expect(
      lie((view, record) =>
        view.setBigUint64(
          record + 48,
          BigInt(PYTHON_ZIP64_TAIL_FILE_SIZE),
          true,
        ),
      ),
    ).toThrow(refused("TRUNCATED"));
  });

  it("refuses a size or offset past 2^53", () => {
    expect(
      lie((view, record) => view.setBigUint64(record + 48, 2n ** 60n, true)),
    ).toThrow(refused("TRUNCATED"));
    expect(
      lie((view, record) => view.setBigUint64(record + 40, 2n ** 53n, true)),
    ).toThrow(refused("TRUNCATED"));
  });

  it("refuses an entry size that is not a safe integer", () => {
    // Mutation: delete the high-word check in readUint64 (the 2^60 would come
    // back as a rounded number).
    const zip = PYTHON_BIG_ENTRY_ZIP.slice();
    const view = new DataView(zip.buffer);
    const cd = view.getUint32(zip.length - 22 + 16, true);
    view.setBigUint64(cd + 46 + 39 + 4, 2n ** 60n, true);
    expect(() => parse(zip)).toThrow(refused("TRUNCATED"));
  });

  it("refuses a count above the entries the directory has", () => {
    // Mutation: break out of the entry loop instead of throwing.
    expect(
      lie((view, record) => view.setBigUint64(record + 32, 5n, true)),
    ).toThrow(refused("TRUNCATED"));
    expect(
      lie((view, record) => view.setBigUint64(record + 32, 2n ** 40n, true)),
    ).toThrow(refused("TRUNCATED"));
  });

  it("refuses an entry whose 4 GiB size has no Zip64 extra field", () => {
    // Mutation: keep 0xFFFFFFFF as the size when the extra field is missing.
    const zip = buildZip([{ name: "a/b_2400004_56_0001_0001.laz" }]);
    const entry = zip.length - 22 - (46 + 28);
    new DataView(zip.buffer).setUint32(entry + 24, 0xffffffff, true);
    expect(() => parse(zip)).toThrow(refused("TRUNCATED"));
  });

  it("refuses a Zip64 extra field cut short", () => {
    // Mutation: read the 8 bytes without checking the field's length.
    const zip = PYTHON_BIG_ENTRY_ZIP.slice();
    const view = new DataView(zip.buffer);
    const cd = view.getUint32(zip.length - 22 + 16, true);
    // First entry: the extra field header's length, 16 down to 4 bytes.
    view.setUint16(cd + 46 + 39 + 2, 4, true);
    expect(() => parse(zip)).toThrow(refused("TRUNCATED"));
  });

  it("refuses an extra field longer than the entry", () => {
    // Mutation: delete the `x > extraEnd` check.
    const zip = PYTHON_BIG_ENTRY_ZIP.slice();
    const view = new DataView(zip.buffer);
    const cd = view.getUint32(zip.length - 22 + 16, true);
    view.setUint16(cd + 46 + 39 + 2, 0xffff, true);
    expect(() => parse(zip)).toThrow(refused("TRUNCATED"));
  });
});

describe("isUnsafeZipEntryName", () => {
  it("accepts normal ELVIS paths", () => {
    expect(isUnsafeZipEntryName("folder/sub/file.laz")).toBe(false);
    expect(isUnsafeZipEntryName("NSW Government/DEM/2 Metre/x.tif")).toBe(
      false,
    );
  });

  it("rejects absolute and traversal paths", () => {
    expect(isUnsafeZipEntryName("/etc/passwd")).toBe(true);
    expect(isUnsafeZipEntryName("\\\\evil")).toBe(true);
    expect(isUnsafeZipEntryName("../evil")).toBe(true);
    expect(isUnsafeZipEntryName("a/../../b")).toBe(true);
    expect(isUnsafeZipEntryName("a\\..\\b")).toBe(true);
    expect(isUnsafeZipEntryName("C:/Windows/evil")).toBe(true);
    expect(isUnsafeZipEntryName("C:\\Windows\\evil")).toBe(true);
  });
});

describe("classifyElvisEntries", () => {
  it("DEM + LAZ: the 2 m DEM is the ground, and the point clouds counted", () => {
    const zip = buildZip([
      {
        name: "NSW Government - Spatial Services/DEM/2 Metre/Katoomba201804-LID2-AHD_2566284_56_0002_0002_2m.tif",
        size: 4_900_000,
      },
      {
        name: "NSW Government - Spatial Services/DEM/2 Metre/Katoomba201804-LID2-AHD_2566286_56_0002_0002_2m.tif",
        size: 4_900_000,
      },
      {
        name: "NSW Government - Spatial Services/DEM/2 Metre/metadata/Katoomba201804-LID2-AHD_2566284_56_0002_0002_2m.html",
        size: 11_000,
      },
      {
        name: "NSW Government - Spatial Services/DEM/2 Metre/metadata/Katoomba201804-LID2-AHD_2566286_56_0002_0002_2m.html",
        size: 11_000,
      },
      {
        name: "NSW Government - Spatial Services/Point Clouds/AHD/Katoomba201804-LID2-C3-AHD_2566286_56_0002_0002.laz",
        size: 16_000_000,
      },
      {
        name: "NSW Government - Spatial Services/Point Clouds/AHD/Katoomba201804-LID2-C3-AHD_2566284_56_0002_0002.laz",
        size: 17_000_000,
      },
      {
        name: "NSW Government - Spatial Services/Point Clouds/AHD/metadata/Katoomba201804-LID2-C3-AHD_2566286_56_0002_0002.html",
        size: 11_000,
      },
      {
        name: "NSW Government - Spatial Services/Point Clouds/AHD/metadata/Katoomba201804-LID2-C3-AHD_2566284_56_0002_0002.html",
        size: 11_000,
      },
    ]);
    const entries = parse(zip);
    const stats = classifyElvisEntries(entries);

    expect(stats.mode).toBe("LAZ_ONLY");
    expect(stats.modeLabel).toBe("Ground from the DEM");
    expect(stats.lazCount).toBe(2);
    expect(stats.demCount).toBe(2);
    expect(stats.derivativeTifCount).toBe(0);
    expect(stats.tileCount).toBe(2);
    expect(stats.surveyNames).toEqual(["Katoomba201804"]);
    expect(stats.demResolutionMeters).toBe(2);
    expect(stats.uncompressedBytes).toBeGreaterThan(0);
  });

  it("Mode A: DEM only", () => {
    const zip = buildZip([
      { name: "Survey2023-AHD_1234567_56_0001_0001_1m.tif", size: 1000 },
    ]);
    const stats = classifyElvisEntries(parse(zip));
    expect(stats.mode).toBe("DEM_ONLY");
    expect(stats.lazCount).toBe(0);
    expect(stats.demCount).toBe(1);
  });

  it("Mode C: LAZ only", () => {
    const zip = buildZip([
      { name: "Survey2023-C3-AHD_1234567_56_0001_0001.laz", size: 1000 },
    ]);
    const stats = classifyElvisEntries(parse(zip));
    expect(stats.mode).toBe("LAZ_ONLY");
    expect(stats.lazCount).toBe(1);
    expect(stats.demCount).toBe(0);
  });

  it("throws NO_USABLE_FILES when only HTML metadata", () => {
    const zip = buildZip([
      { name: "folder/file.html" },
      { name: "folder/readme.txt" },
    ]);
    expect(() => classifyElvisEntries(parse(zip))).toThrow(ElvisZipError);
    expect(() => classifyElvisEntries(parse(zip))).toThrowError(
      expect.objectContaining({ code: "NO_USABLE_FILES" }),
    );
  });

  it("throws NO_USABLE_FILES when all tifs are derivatives, mentions count in message", () => {
    const zip = buildZip([
      { name: "area_hillshade.tif" },
      { name: "area_slope.tif" },
      { name: "area_aspect.tif" },
    ]);
    let err: ElvisZipError | undefined;
    try {
      classifyElvisEntries(parse(zip));
    } catch (e) {
      err = e as ElvisZipError;
    }
    expect(err?.code).toBe("NO_USABLE_FILES");
    expect(err?.message).toContain("3 derivative rasters");
  });

  it("throws EMPTY_ZIP on zip with no entries", () => {
    const zip = buildZip([]);
    expect(() => classifyElvisEntries(parse(zip))).toThrow(ElvisZipError);
    expect(() => classifyElvisEntries(parse(zip))).toThrowError(
      expect.objectContaining({ code: "EMPTY_ZIP" }),
    );
  });

  it("filters derivative tifs but counts valid tifs", () => {
    const zip = buildZip([
      { name: "Survey-AHD_1234567_56_0001_0001_2m.tif", size: 1000 },
      { name: "Survey_hillshade.tif" },
      { name: "Survey_colour.tif" },
    ]);
    const stats = classifyElvisEntries(parse(zip));
    expect(stats.demCount).toBe(1);
    expect(stats.derivativeTifCount).toBe(2);
    expect(stats.mode).toBe("DEM_ONLY");
  });

  it("parses DEM resolution from path directory component", () => {
    const zip = buildZip([
      {
        name: "Spatial Services/DEM/1 Metre/SurveyX-AHD_1234_56_0001_0001.tif",
        size: 500,
      },
    ]);
    const stats = classifyElvisEntries(parse(zip));
    expect(stats.demResolutionMeters).toBe(1);
  });

  it("returns null demResolutionMeters when mixed resolutions", () => {
    const zip = buildZip([
      { name: "SurveyA-AHD_1111_56_0001_0001_1m.tif", size: 500 },
      { name: "SurveyA-AHD_1112_56_0001_0002_2m.tif", size: 500 },
    ]);
    const stats = classifyElvisEntries(parse(zip));
    expect(stats.demResolutionMeters).toBeNull();
  });

  it("throws UNSAFE_PATH on a parent-directory traversal entry (zip-slip)", () => {
    const zip = buildZip([
      { name: "Survey-AHD_1234567_56_0001_0001_2m.tif", size: 1000 },
      { name: "../../../app/evil.py", size: 10 },
    ]);
    let err: ElvisZipError | undefined;
    try {
      classifyElvisEntries(parse(zip));
    } catch (e) {
      err = e as ElvisZipError;
    }
    expect(err?.code).toBe("UNSAFE_PATH");
  });

  it("throws UNSAFE_PATH on an absolute path entry", () => {
    const zip = buildZip([
      { name: "Survey-AHD_1234567_56_0001_0001_2m.tif", size: 1000 },
      { name: "/etc/cron.d/evil", size: 10 },
    ]);
    expect(() => classifyElvisEntries(parse(zip))).toThrowError(
      expect.objectContaining({ code: "UNSAFE_PATH" }),
    );
  });

  it("collects unique tile IDs across LAZ and DEM", () => {
    const zip = buildZip([
      { name: "Survey-C3-AHD_1111_56_0001_0001.laz", size: 100 },
      { name: "Survey-C3-AHD_1112_56_0001_0002.laz", size: 100 },
      { name: "Survey-AHD_1111_56_0001_0001_2m.tif", size: 100 }, // same tile as first LAZ
      { name: "Survey-AHD_1113_56_0001_0003_2m.tif", size: 100 }, // new tile
    ]);
    const stats = classifyElvisEntries(parse(zip));
    // tile IDs: 1111_56_0001_0001 (from LAZ + DEM, deduplicated), 1112_56_0001_0002, 1113_56_0001_0003
    expect(stats.tileCount).toBe(3);
  });

  it("flags overlapping surveys: two LAZ surveys over one footprint", () => {
    const zip = buildZip([
      { name: "Mudgee201408-LID1-C3-AHD_7766366_55_0002_0002.laz", size: 100 },
      { name: "Mudgee201612-LID2-C3-AHD_7766366_55_0002_0002.laz", size: 100 },
    ]);
    const stats = classifyElvisEntries(parse(zip));
    expect(stats.lazCount).toBe(2);
    expect(stats.tileCount).toBe(1); // one footprint
    expect(stats.overlappingSurveys).toBe(true);
  });

  it("no overlap flag when each LAZ covers a distinct footprint", () => {
    const zip = buildZip([
      { name: "Mudgee201408-LID1-C3-AHD_7766366_55_0002_0002.laz", size: 100 },
      { name: "Mudgee201408-LID1-C3-AHD_7766368_55_0002_0002.laz", size: 100 },
    ]);
    const stats = classifyElvisEntries(parse(zip));
    expect(stats.tileCount).toBe(2);
    expect(stats.overlappingSurveys).toBe(false);
  });

  it("does not flag overlap in DEM-only mode (survey selection is LAZ-only)", () => {
    const zip = buildZip([
      { name: "SurveyA-AHD_1111_56_0001_0001_2m.tif", size: 100 },
      { name: "SurveyB-AHD_1111_56_0001_0001_2m.tif", size: 100 }, // same footprint, 2 DEMs
    ]);
    const stats = classifyElvisEntries(parse(zip));
    expect(stats.mode).toBe("DEM_ONLY");
    expect(stats.overlappingSurveys).toBe(false);
  });
});

describe("classifyElvisEntries for a job that sharpens", () => {
  const dem = (metres: number) => ({
    name: `DEM/${metres} Metre/Madeup2023-AHD_1234567_56_0001_0001_${metres}m.tif`,
    size: 1000,
  });
  const laz = {
    name: "Madeup2023-C3-AHD_1234567_56_0001_0001.laz",
    size: 1000,
  };
  const label = (files: { name: string; size: number }[]) =>
    classifyElvisEntries(parse(buildZip(files))).modeLabel;

  // Mutation: label a ZIP with a fine DEM "from the point clouds", while
  // topo/sharpen.py's dem_plan takes the DEM as ground.
  it("says where the ground comes from, as sharpen.py chooses it", () => {
    expect(label([dem(2), laz])).toBe("Ground from the DEM");
    expect(label([dem(1)])).toBe("Ground from the DEM");
    expect(label([laz])).toBe("Ground from the point clouds");
    expect(label([dem(5), laz])).toBe("Ground from the point clouds");
  });

  // Mutation: let a ZIP of 5 m DEMs through, and the job is refused by the
  // worker only after the upload and a charged launch.
  it("refuses a ZIP of 5 m DEMs only, before it is uploaded", () => {
    const only5m = parse(buildZip([dem(5), dem(5)]));
    expect(() => classifyElvisEntries(only5m)).toThrow(ElvisZipError);
  });

  // Mutation: change the coarsest DEM cell sharpen.py grounds on (its
  // `zoom_for_cell`), and the form labels or refuses a ZIP the worker would
  // treat otherwise.
  it("grounds on the DEMs sharpen.py does", () => {
    const python = readFileSync(
      join(import.meta.dirname, "../../topo/sharpen.py"),
      "utf8",
    );
    const coarsest = Number(
      /if cell_m <= ([\d.]+):\n\s+return 16/.exec(python)![1],
    );
    expect(label([dem(coarsest)])).toBe("Ground from the DEM");
    expect(() =>
      classifyElvisEntries(parse(buildZip([dem(coarsest + 0.5)]))),
    ).toThrow(ElvisZipError);
  });

  // Mutation: reword one copy, and the form and the worker refuse the same
  // ZIP in two different sentences.
  it("refuses it in the worker's own words", () => {
    const python = readFileSync(
      join(import.meta.dirname, "../../topo/sharpen.py"),
      "utf8",
    );
    const declared = /^ONLY_5M = \(\n((?:\s+".*"\n)+)\)/m.exec(python)![1]!;
    const sentence = [...declared.matchAll(/"(.*)"/g)]
      .map((m) => m[1])
      .join("");
    try {
      classifyElvisEntries(parse(buildZip([dem(5)])));
    } catch (error) {
      expect((error as ElvisZipError).sentence).toBe(sentence);
      return;
    }
    throw new Error("a 5 m-only ZIP was accepted");
  });
});

describe("regionNameFromSurvey", () => {
  it("strips the trailing numeric survey code", () => {
    expect(regionNameFromSurvey("Katoomba201804")).toBe("Katoomba");
  });

  it("returns the name unchanged when there is no numeric code", () => {
    expect(regionNameFromSurvey("Katoomba")).toBe("Katoomba");
  });

  it("falls back to the full survey name when there is no alphabetic prefix", () => {
    expect(regionNameFromSurvey("216028")).toBe("216028");
    expect(regionNameFromSurvey("")).toBe("");
  });
});
