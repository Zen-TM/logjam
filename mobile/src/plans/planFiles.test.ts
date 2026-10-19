import { describe, expect, it, vi } from "vitest";

vi.mock("expo-file-system/legacy", () => ({ documentDirectory: "file:///d/" }));
vi.mock("../api/presignedTransfer", () => ({}));
vi.mock("../offline/localStores", () => ({ PLAN_DIR: "file:///d/plans/" }));

const { planFileUri, planFiles } = await import("./planFiles");

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
