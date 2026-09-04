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
// An import is a standalone media row now, so this module reaches the sync
// layer — which reaches react-native. Stubbed to the two calls it makes.
vi.mock("../sync/mediaUpload", () => ({
  createStandaloneMediaLocal: vi.fn(),
  deleteMediaLocal: vi.fn(),
}));
vi.mock("../sync/mirrorStore", () => ({ getMediaById: vi.fn() }));
vi.mock("../sync/mediaCache", () => ({ ensureDisplayCached: vi.fn() }));
vi.mock("../offline/localStores", () => ({
  IMPORTS_DIR: "file:///imports/",
  scratchFileUri: vi.fn(async (name: string) => `file:///scratch/${name}`),
}));

const { kmlFromKmz } = await import("./vectorImports");

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
  // Logjam", a friend's file-send). The old `unzipSync(bytes)` inflated this
  // eagerly and returned the text.
  it("refuses a .kml that declares more than the import ceiling", () => {
    const zip = zipSync({ "doc.kml": new Uint8Array(31 * 1024 * 1024) }, { level: 9 });
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
