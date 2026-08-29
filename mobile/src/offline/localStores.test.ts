import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The regression this file exists for: the sign-out wipe is the privacy
// boundary between two users of one phone, and three separate stores had
// drifted out of it — GPX track exports written to `cacheDirectory`, the
// scratch PDFs beside them, and MapLibre's ambient tile cache. Each was
// invisible the same way: a path literal written at the producer, and a wipe
// list maintained somewhere else that nobody thought to join.
//
// So: read the source. A file that reaches for a filesystem root without going
// through `localStores.ts` fails this test, which makes "add a store, forget
// the wipe" a build failure rather than a leak nobody sees until an audit.
//
// It scans text rather than importing anything, because `localStores.ts` pulls
// in expo-file-system and the native module — neither of which exists in a
// vitest process. Same technique as `sync/mirrorSchema.test.ts`.

const SRC_DIR = join(__dirname, "..");
const DECLARATION = join(SRC_DIR, "offline", "localStores.ts");

/** Every way to name a filesystem ROOT across the two expo-file-system APIs. */
// Not /g — `.test()` on a global regex carries lastIndex between calls.
const ROOT_ACCESS = /FileSystem\.(document|cache)Directory|\bPaths\.(document|cache)\b/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!/\.tsx?$/.test(entry.name) || entry.name.endsWith(".test.ts")) return [];
    return [path];
  });
}

/** Source with `//` and `/* *​/` comments removed — a prose mention of
 * documentDirectory is not a store. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function declaration(): string {
  return readFileSync(DECLARATION, "utf8");
}

describe("every local store is declared in one place", () => {
  it("is the only file that names a filesystem root", () => {
    const offenders = sourceFiles(SRC_DIR)
      .filter((file) => file !== DECLARATION)
      .filter((file) => ROOT_ACCESS.test(code(readFileSync(file, "utf8"))))
      .map((file) => file.slice(SRC_DIR.length + 1));
    // A directory built from documentDirectory anywhere else is a store the
    // wipe has never heard of. Put it in localStores.ts and import it.
    expect(offenders).toEqual([]);
  });

  it("actually looks at the source", () => {
    // A scanner matching nothing would pass the test above forever.
    expect(sourceFiles(SRC_DIR).length).toBeGreaterThan(50);
    expect(ROOT_ACCESS.test(code(declaration()))).toBe(true);
    expect(
      ROOT_ACCESS.test(code("// a comment about FileSystem.documentDirectory")),
    ).toBe(false);
  });
});

describe("the wipe covers every declared store", () => {
  const source = declaration();

  /** Directory constants declared in localStores.ts, by export name. */
  function declaredDirs(): string[] {
    return [...source.matchAll(/export const (\w+_DIR) =/g)].map((m) => m[1]);
  }

  /** The names listed in WIPED_DIRS. */
  function wipedDirs(): string[] {
    const block = source.match(/export const WIPED_DIRS = \[([\s\S]*?)\]/);
    if (!block) throw new Error("WIPED_DIRS is gone — the wipe has no list");
    return [...block[1].matchAll(/\b([A-Z][A-Z0-9_]*_DIR)\b/g)].map((m) => m[1]);
  }

  it("wipes every declared directory that is not explicitly spared", () => {
    // BASEMAP_ASSETS_DIR is the one deliberate exception: generic Protomaps
    // glyphs and sprites, identical for every user, re-extracted on demand.
    // Anything else missing from WIPED_DIRS is a store that survives sign-out.
    const spared = ["BASEMAP_ASSETS_DIR"];
    const missing = declaredDirs().filter(
      (name) => !wipedDirs().includes(name) && !spared.includes(name),
    );
    expect(missing).toEqual([]);
  });

  it("holds the stores the audit found leaking", () => {
    const wiped = wipedDirs();
    // Track GPX exports and staged PDFs — cacheDirectory was in no list at all.
    expect(wiped).toContain("SCRATCH_DIR");
    expect(wiped).toContain("REGION_DIR");
    expect(wiped).toContain("IMPORTS_DIR");
    expect(wiped).toContain("MEDIA_CACHE_DIR");
    expect(wiped).toContain("OVERLAY_DIR");
  });

  it("keeps the spared directory out of the wipe, on purpose", () => {
    expect(declaredDirs()).toContain("BASEMAP_ASSETS_DIR");
    expect(wipedDirs()).not.toContain("BASEMAP_ASSETS_DIR");
  });
});

describe("the wipe stops the producers before it deletes", () => {
  const wipe = readFileSync(join(SRC_DIR, "offline", "wipeLocalData.ts"), "utf8");

  it("cancels both background workers", () => {
    // A run still going re-created the directory the wipe had deleted and
    // re-inserted its map_artifact row — the departing user's bbox landing in
    // the next user's install after the wipe reported success.
    expect(wipe).toContain("cancelAllRegionDownloads()");
    expect(wipe).toContain("stopGeoPdfImportRun()");
  });

  it("stops them before the first delete", () => {
    const stopAt = wipe.indexOf("cancelAllRegionDownloads()");
    const deleteAt = wipe.indexOf("FileSystem.deleteAsync");
    const tablesAt = wipe.indexOf("DELETE FROM");
    expect(stopAt).toBeGreaterThan(-1);
    expect(stopAt).toBeLessThan(deleteAt);
    expect(stopAt).toBeLessThan(tablesAt);
  });

  it("clears MapLibre's ambient tile cache", () => {
    // Confirmed on device: 13 tile rows (z/x/y of the areas browsed) survived
    // a full sign-out byte-for-byte, because nothing owned that store.
    expect(wipe).toContain("OfflineManager");
    expect(wipe).toContain("resetDatabase()");
  });
});

describe("the wipe empties the app cache directory", () => {
  const wipe = readFileSync(join(SRC_DIR, "offline", "wipeLocalData.ts"), "utf8");

  it("sweeps the cache ROOT, not a list of picker paths", () => {
    // MOT-005: the OS pickers keep their own copy of every attached photo and
    // file in a subdirectory of the cache. Decision D6 rejected adding those
    // paths to WIPED_DIRS — they mirror a third-party native module's
    // internals and drift on upgrade — in favour of emptying the whole cache
    // directory, which names nothing that can drift and also catches the files
    // earlier builds already left behind.
    expect(wipe).toContain("readDirectoryAsync(CACHE_ROOT)");
    expect(code(wipe)).not.toMatch(/ImagePicker|DocumentPicker/);
  });

  it("declares the cache root beside every other store", () => {
    // Emptied rather than deleted, so it is not a WIPED_DIRS entry — but it is
    // still the one file allowed to name a filesystem root.
    expect(declaration()).toMatch(/export const CACHE_ROOT = FileSystem\.cacheDirectory/);
  });

  it("sweeps last, so a cache failure cannot cost a store", () => {
    // The stores are the privacy boundary; the cache is a follow-up. Best
    // effort, and after everything that matters is already gone.
    const storesAt = wipe.indexOf("for (const dir of WIPED_DIRS)");
    const cacheAt = wipe.indexOf("readDirectoryAsync(CACHE_ROOT)");
    expect(storesAt).toBeGreaterThan(-1);
    expect(cacheAt).toBeGreaterThan(storesAt);
  });
});
