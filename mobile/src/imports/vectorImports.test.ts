import { describe, expect, it, vi } from "vitest";
import { zipSync, strToU8 } from "fflate";

// vectorImports.ts is a device module (picker, filesystem, registry DB); only
// the KMZ reader is pure, so the native edges are stubbed to get at it.
vi.mock("expo-document-picker", () => ({ getDocumentAsync: vi.fn() }));
vi.mock("expo-file-system/legacy", () => ({
  deleteAsync: vi.fn(),
  readAsStringAsync: vi.fn(),
  writeAsStringAsync: vi.fn(),
  makeDirectoryAsync: vi.fn(),
  getInfoAsync: vi.fn(),
  copyAsync: vi.fn(),
}));
vi.mock("expo-file-system", () => ({ File: class {} }));
vi.mock("./importsDb", () => ({
  deleteImportViewState: vi.fn(),
  getVectorImport: vi.fn(),
  upsertImportViewState: vi.fn(),
}));
// An import is a standalone media row, so this module reaches the sync
// layer — which reaches react-native. Stubbed to the two calls it makes.
vi.mock("../sync/mediaUpload", () => ({
  createStandaloneMediaLocal: vi.fn(),
  deleteMediaLocal: vi.fn(),
}));
vi.mock("../sync/mirrorStore", () => ({ getMediaById: vi.fn() }));
vi.mock("../sync/mediaCache", () => ({ ensureDisplayCached: vi.fn() }));
const plan = vi.hoisted(() => ({ uploadPlanFile: vi.fn() }));
vi.mock("../plans/planFileUpload", () => ({
  uploadPlanFile: plan.uploadPlanFile,
}));
vi.mock("../offline/localStores", () => ({
  IMPORTS_DIR: "file:///imports/",
  scratchFileUri: vi.fn(async (name: string) => `file:///scratch/${name}`),
}));

const { kmlFromKmz, pickImportColor, importVectorFileIntoPlan } = await import(
  "./vectorImports"
);
const FileSystem = await import("expo-file-system/legacy");
const DocumentPicker = await import("expo-document-picker");
const mediaUpload = await import("../sync/mediaUpload");
const { TRACK_COLORS } = await import("@logjam/shared");

const KML = `<?xml version="1.0"?><kml><Document><Placemark><Point>
  <coordinates>150.4,-33.5,0</coordinates></Point></Placemark></Document></kml>`;

describe("kmlFromKmz", () => {
  it("returns doc.kml in preference to another .kml", () => {
    const zip = zipSync({
      "other.kml": strToU8("<kml>other</kml>"),
      "doc.kml": strToU8(KML),
    });
    expect(kmlFromKmz(zip)).toEqual({ fileName: "doc.kml", text: KML });
  });

  it("falls back to any .kml entry", () => {
    const zip = zipSync({ "nested/route.kml": strToU8(KML) });
    expect(kmlFromKmz(zip).fileName).toBe("nested/route.kml");
  });

  // THE ZIP BOMB. The 30 MB import ceiling is checked against the COMPRESSED
  // file, so without a cap on the declared uncompressed size this entry alone
  // inflates past it — and a real hostile archive scales that to gigabytes on
  // the one input path an outside party controls (share sheet, "Open in
  // Logjam", a friend's file-send).
  it("refuses a .kml that declares more than the import ceiling", () => {
    const zip = zipSync(
      { "doc.kml": new Uint8Array(31 * 1024 * 1024) },
      { level: 9 },
    );
    expect(zip.length).toBeLessThan(1024 * 1024); // it IS a bomb: ~1000:1
    expect(() => kmlFromKmz(zip)).toThrow(/too (big|large)/i);
  });

  it("refuses an archive with no .kml in it", () => {
    const zip = zipSync({ "overlay.png": new Uint8Array(16) });
    expect(() => kmlFromKmz(zip)).toThrow();
  });

  it("refuses bytes that are not a zip at all", () => {
    expect(() => kmlFromKmz(strToU8("not a zip"))).toThrow();
  });
});

describe("pickImportColor", () => {
  // The server reassigns an import's colour at upload with
  // pickNextTrackColor over what the account already holds. A local guess made
  // by count would disagree once an import is deleted (two left, colours 0
  // and 2: count says 2, which is taken).
  it("is the colour the server will pick: the first one not in use", () => {
    expect(pickImportColor([TRACK_COLORS[0], TRACK_COLORS[2]])).toBe(
      TRACK_COLORS[1],
    );
  });

  it("ignores rows with no colour", () => {
    expect(pickImportColor([null, undefined])).toBe(TRACK_COLORS[0]);
  });
});

describe("importVectorFileIntoPlan", () => {
  const GPX = `<?xml version="1.0"?><gpx version="1.1"><trk><name>Ridge</name><trkseg>
    <trkpt lat="-33.5" lon="150.4"></trkpt><trkpt lat="-33.51" lon="150.41"></trkpt>
  </trkseg></trk></gpx>`;

  function pick(name: string) {
    vi.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue({
      canceled: false,
      assets: [{ uri: "file:///cache/pick.gpx", name }],
    } as never);
    vi.mocked(FileSystem.getInfoAsync).mockResolvedValue({
      exists: true,
      size: GPX.length,
    } as never);
    vi.mocked(FileSystem.readAsStringAsync).mockResolvedValue(GPX);
    vi.mocked(FileSystem.deleteAsync).mockResolvedValue(undefined);
  }

  // Mutation: leave the uploaded scratch copy out of the cleanup, and it stays
  // on the phone.
  it("uploads the file into the plan and keeps nothing in the account", async () => {
    vi.clearAllMocks();
    pick("ridge.gpx");
    expect(await importVectorFileIntoPlan("p")).toEqual({
      status: "added",
      name: "Ridge",
    });
    expect(plan.uploadPlanFile).toHaveBeenCalledTimes(1);
    expect(plan.uploadPlanFile).toHaveBeenCalledWith(
      "p",
      expect.objectContaining({
        filename: "Ridge.gpx",
        displayName: "Ridge",
        mediaType: "application/gpx+xml",
        metadata: expect.objectContaining({ featureCount: 1 }),
      }),
    );
    expect(mediaUpload.createStandaloneMediaLocal).not.toHaveBeenCalled();
    // The scratch copy that was uploaded is deleted.
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith(
      expect.stringContaining("plan-import-"),
      { idempotent: true },
    );
  });

  // Mutation: as above, for the path that throws.
  it("deletes the scratch copy when the upload fails", async () => {
    vi.clearAllMocks();
    pick("ridge.gpx");
    plan.uploadPlanFile.mockRejectedValueOnce(new Error("offline"));
    await expect(importVectorFileIntoPlan("p")).rejects.toThrow("offline");
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith(
      expect.stringContaining("plan-import-"),
      { idempotent: true },
    );
  });

  it("uploads nothing when the picker is cancelled", async () => {
    vi.clearAllMocks();
    vi.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue({
      canceled: true,
      assets: null,
    } as never);
    expect(await importVectorFileIntoPlan("p")).toEqual({
      status: "cancelled",
    });
    expect(plan.uploadPlanFile).not.toHaveBeenCalled();
  });
});
