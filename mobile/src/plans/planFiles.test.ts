import { beforeEach, describe, expect, it, vi } from "vitest";

const fs = vi.hoisted(() => ({
  documentDirectory: "file:///d/",
  getInfoAsync: vi.fn(async () => ({ exists: true })),
  readDirectoryAsync: vi.fn(async (): Promise<string[]> => []),
  deleteAsync: vi.fn(async () => {}),
  makeDirectoryAsync: vi.fn(async () => {}),
  moveAsync: vi.fn(async () => {}),
  // No imports file until a test gives one.
  readAsStringAsync: vi.fn(async (_uri: string): Promise<string> => {
    throw new Error("no file");
  }),
  writeAsStringAsync: vi.fn(async () => {}),
}));
vi.mock("expo-file-system/legacy", () => fs);
const transfer = vi.hoisted(() => ({
  downloadFromPresignedUrl: vi.fn(async () => ({ status: 200 })),
}));
vi.mock("../api/presignedTransfer", () => transfer);
vi.mock("../offline/localStores", () => ({ PLAN_DIR: "file:///d/plans/" }));
const geoPdf = vi.hoisted(() => ({
  deleteGeoPdfImport: vi.fn(async () => {}),
}));
vi.mock("../geopdf/importPipeline", () => geoPdf);

const {
  downloadPlanFiles,
  linkingProgress,
  linkPlanGeoPdfImport,
  planFileSource,
  planFileUri,
  planFiles,
  prunePlanFiles,
  sweepPlanFolders,
} = await import("./planFiles");

beforeEach(() => vi.clearAllMocks());

const base = { addedBy: null, createdAt: "", updatedAt: "" };
const media = (id: string) => ({
  id,
  displayUrl: `https://s3/${id}`,
  filename: `${id}.jpg`,
  sizeBytes: "10",
});

describe("what Download for the trip fetches", () => {
  // Mutation: drop the geoPdfs' downloadUrl check, and a GeoPDF still
  // rendering fails the whole download.
  it("takes place photos, files and ready GeoPDFs", () => {
    const plan = {
      places: [{ ...base, media: [media("p1")] }],
      files: [{ ...base, sizeBytes: "20", item: media("f1") }],
      geoPdfs: [
        { ...base, id: "g1", sizeBytes: "30", downloadUrl: "https://s3/g1" },
        { ...base, id: "g2", sizeBytes: "40", downloadUrl: null },
      ],
    } as never;
    expect(planFiles(plan).map((file) => [file.id, file.sizeBytes])).toEqual([
      ["p1", 10],
      ["f1", 20],
      ["g1", 30],
    ]);
  });

  // Mutation: build the path from the filename. A name like "../x" would
  // write outside the plan's folder.
  it("names a file by its id, keeping only a clean extension", () => {
    expect(planFileUri("plan 1", { id: "m1", filename: "../x.j?pg" })).toBe(
      "file:///d/plans/plan%201/m1.jpg",
    );
  });
});

const file = (id: string) => ({
  id,
  url: `https://s3/${id}`,
  filename: `${id}.jpg`,
  sizeBytes: 10,
});
describe("where a plan's file opens from", () => {
  const onPhone = new Set(["a"]);

  // Mutation: prefer the URL while online, and a downloaded photo still
  // fetches (and fails once the presigned URL has expired).
  it("opens the phone's copy once downloaded, online or not", () => {
    for (const online of [true, false])
      expect(planFileSource("p", file("a"), onPhone, online)).toBe(
        "file:///d/plans/p/a.jpg",
      );
  });

  // Mutation: drop the `online` check, and offline a row opens a URL that
  // can't load instead of saying "Needs a connection".
  it("opens the URL online, and nothing offline, when not downloaded", () => {
    expect(planFileSource("p", file("b"), onPhone, true)).toBe("https://s3/b");
    expect(planFileSource("p", file("b"), onPhone, false)).toBeNull();
  });

  // Mutation: fall back to a made-up path, and a GeoPDF still rendering opens
  // a file that isn't there.
  it("opens nothing for a file with no URL yet", () => {
    expect(planFileSource("p", undefined, onPhone, true)).toBeNull();
  });
});

const deleted = () =>
  fs.deleteAsync.mock.calls.map((call) => (call as unknown[])[0]);

describe("a plan's files leave the phone with it", () => {
  // Mutation: invert `!keep.has(…)`, or drop the decodeURIComponent. Kept
  // plans' folders would go, or a dropped plan's stay.
  it("sweeps only the folders of plans no longer cached", async () => {
    fs.readDirectoryAsync.mockResolvedValueOnce([
      "kept",
      "plan%201",
      "dropped",
    ]);
    await sweepPlanFolders(new Set(["kept", "plan 1"]));
    expect(deleted()).toEqual(["file:///d/plans/dropped/"]);
  });

  // Mutation: drop the keep check in prunePlanFiles. Every file would go on
  // each refetch.
  it("prunes a removed item's file and a stray partial, keeping the rest", async () => {
    fs.readDirectoryAsync.mockResolvedValueOnce([
      "a.jpg",
      "a.jpg.part",
      "gone.jpg",
      "gone.jpg.part",
    ]);
    await prunePlanFiles("p", [file("a")]);
    expect(deleted()).toEqual([
      "file:///d/plans/p/gone.jpg",
      "file:///d/plans/p/gone.jpg.part",
    ]);
  });
});

describe("a plan's GeoPDFs on the map go with the plan", () => {
  const imports = (links: Record<string, string>) =>
    fs.readAsStringAsync.mockResolvedValueOnce(JSON.stringify(links));

  // Mutation: delete only the folder in sweepPlanFolders, and a plan the
  // caller left, or was removed from, stays on their map.
  it("deletes the imports a dropped plan's folder names", async () => {
    fs.readDirectoryAsync.mockResolvedValueOnce(["kept", "dropped"]);
    fs.readAsStringAsync.mockImplementation(async (uri: string) => {
      if (uri === "file:///d/plans/dropped/geopdf-imports.json")
        return JSON.stringify({ g1: "import-1" });
      throw new Error("no file");
    });
    try {
      await sweepPlanFolders(new Set(["kept"]));
    } finally {
      fs.readAsStringAsync.mockReset();
      fs.readAsStringAsync.mockRejectedValue(new Error("no file"));
    }
    expect(geoPdf.deleteGeoPdfImport.mock.calls).toEqual([["import-1"]]);
    expect(deleted()).toEqual(["file:///d/plans/dropped/"]);
  });

  // Mutation: leave the imports file out of prune's keep set, or skip the
  // `gone` check. The links would go on the next refetch, or a GeoPDF taken
  // out of the plan would stay on the map.
  it("prunes the import of a GeoPDF gone from the plan, and keeps the links", async () => {
    imports({ g1: "import-1", gone: "import-2" });
    fs.readDirectoryAsync.mockResolvedValueOnce([
      "geopdf-imports.json",
      "g1.pdf",
    ]);
    await prunePlanFiles("p", [{ ...file("g1"), filename: "g1.pdf" }]);
    expect(geoPdf.deleteGeoPdfImport.mock.calls).toEqual([["import-2"]]);
    expect(fs.writeAsStringAsync).toHaveBeenCalledWith(
      "file:///d/plans/p/geopdf-imports.json",
      JSON.stringify({ g1: "import-1" }),
    );
    expect(deleted()).toEqual([]);
  });

  // Mutation: link on the import's outcome instead. One that fails (a full
  // phone) or is killed mid-render keeps its record and the other member's
  // PDF, unswept, and Saved offers to finish it as the caller's own.
  it("links the import on its first id, before it can fail", async () => {
    const seen: unknown[] = [];
    const report = linkingProgress("p", "g1", (progress) =>
      seen.push(progress),
    );
    report({ phase: "hashing", fraction: 0 });
    expect(fs.writeAsStringAsync).not.toHaveBeenCalled();
    report({ phase: "planning", fraction: 0, importId: "import-1" });
    report({ phase: "rasterising", fraction: 0.5, importId: "import-1" });
    // The import throws here; the link is already on its way.
    await vi.waitFor(() =>
      expect(fs.writeAsStringAsync).toHaveBeenCalledWith(
        "file:///d/plans/p/geopdf-imports.json",
        JSON.stringify({ g1: "import-1" }),
      ),
    );
    expect(fs.writeAsStringAsync).toHaveBeenCalledTimes(1);
    expect(seen).toHaveLength(3);
  });

  // Mutation: overwrite the file with only the new link, and a plan's first
  // GeoPDF outlives the plan once a second is opened.
  it("adds a link beside the plan's others", async () => {
    imports({ g1: "import-1" });
    await linkPlanGeoPdfImport("p", "g2", "import-2");
    expect(fs.writeAsStringAsync).toHaveBeenCalledWith(
      "file:///d/plans/p/geopdf-imports.json",
      JSON.stringify({ g1: "import-1", g2: "import-2" }),
    );
  });
});

describe("downloadPlanFiles", () => {
  // Mutation: delete the partial only on a non-200. A dropped connection
  // would leave dead bytes in the plan's folder.
  it("deletes a file's partial when its download throws", async () => {
    transfer.downloadFromPresignedUrl.mockRejectedValueOnce(new Error("drop"));
    await expect(
      downloadPlanFiles(
        "p",
        [file("a")],
        () => {},
        () => true,
      ),
    ).rejects.toThrow("drop");
    expect(deleted()).toEqual(["file:///d/plans/p/a.jpg.part"]);
  });

  // Mutation: drop the `alive` check before makeDirectoryAsync. A download
  // running at sign-out would re-create the plan's folder after the wipe.
  it("writes nothing once the wipe has stopped it", async () => {
    expect(
      await downloadPlanFiles(
        "p",
        [file("a")],
        () => {},
        () => false,
      ),
    ).toBe(false);
    expect(fs.makeDirectoryAsync).not.toHaveBeenCalled();
    expect(transfer.downloadFromPresignedUrl).not.toHaveBeenCalled();
  });
});
