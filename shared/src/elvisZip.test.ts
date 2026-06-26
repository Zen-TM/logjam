import { describe, it, expect } from "vitest";
import {
  parseZipCentralDirectory,
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
    expect(() =>
      parseZipCentralDirectory(new Uint8Array(10), 10),
    ).toThrow(ElvisZipError);
  });

  it("handles empty zip (no entries)", () => {
    const zip = buildZip([]);
    const entries = parse(zip);
    expect(entries).toHaveLength(0);
  });
});

describe("isUnsafeZipEntryName", () => {
  it("accepts normal ELVIS paths", () => {
    expect(isUnsafeZipEntryName("folder/sub/file.laz")).toBe(false);
    expect(isUnsafeZipEntryName("NSW Government/DEM/2 Metre/x.tif")).toBe(false);
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
  it("Mode B: DEM + LAZ — ELVIS example layout", () => {
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

    expect(stats.mode).toBe("DEM_LAZ");
    expect(stats.modeLabel).toBe("DEM + LiDAR (full output)");
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
