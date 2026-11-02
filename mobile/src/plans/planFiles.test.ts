import { beforeEach, describe, expect, it, vi } from "vitest";

const fs = vi.hoisted(() => ({
  documentDirectory: "file:///d/",
  getInfoAsync: vi.fn(async () => ({ exists: true })),
  readDirectoryAsync: vi.fn(async (): Promise<string[]> => []),
  deleteAsync: vi.fn(async () => {}),
  makeDirectoryAsync: vi.fn(async () => {}),
  moveAsync: vi.fn(async () => {}),
}));
vi.mock("expo-file-system/legacy", () => fs);
const transfer = vi.hoisted(() => ({
  downloadFromPresignedUrl: vi.fn(async () => ({ status: 200 })),
}));
vi.mock("../api/presignedTransfer", () => transfer);
vi.mock("../offline/localStores", () => ({ PLAN_DIR: "file:///d/plans/" }));
const {
  downloadPlanFiles,
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
  it("takes place photos and files", () => {
    const plan = {
      places: [{ ...base, media: [media("p1")] }],
      files: [{ ...base, sizeBytes: "20", item: media("f1") }],
    } as never;
    expect(planFiles(plan).map((file) => [file.id, file.sizeBytes])).toEqual([
      ["p1", 10],
      ["f1", 20],
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

  // Mutation: fall back to a made-up path, and a file that isn't listed opens
  // one that isn't there.
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
