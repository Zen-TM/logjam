import { describe, expect, it, vi } from "vitest";
import { attachBatch, libraryPickerOptions } from "./attachBatch";

const photo = (n: number) => ({ uri: `file:///p${n}`, mimeType: "image/jpeg" });

describe("attachBatch", () => {
  // Mutation: rethrow from the catch (or `break`) and the files after the bad
  // one are never attached, and the first two assertions fail.
  it("keeps going past a file that fails and counts it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const seen: string[] = [];
    const result = await attachBatch([photo(1), photo(2), photo(3)], (file) => {
      seen.push(file.uri);
      return file.uri.endsWith("p2")
        ? Promise.reject(new Error("unreadable"))
        : Promise.resolve();
    });
    expect(seen).toEqual(["file:///p1", "file:///p2", "file:///p3"]);
    expect(result.added.map((f) => f.uri)).toEqual([
      "file:///p1",
      "file:///p3",
    ]);
    expect(result.failed).toBe(1);
  });

  // Mutation: run with Promise.all and the order assertion below sees the
  // second file start before the first has finished.
  it("attaches one file at a time", async () => {
    const log: string[] = [];
    await attachBatch([photo(1), photo(2)], async (file) => {
      log.push(`start ${file.uri}`);
      await Promise.resolve();
      log.push(`end ${file.uri}`);
    });
    expect(log).toEqual([
      "start file:///p1",
      "end file:///p1",
      "start file:///p2",
      "end file:///p2",
    ]);
  });
});

describe("libraryPickerOptions", () => {
  // Mutation: delete `allowsMultipleSelection` from libraryPickerOptions and
  // the picker goes back to one photo at a time.
  it("lets the library pick take several", () => {
    expect(libraryPickerOptions(["images", "videos"])).toMatchObject({
      allowsMultipleSelection: true,
      mediaTypes: ["images", "videos"],
    });
  });
});
