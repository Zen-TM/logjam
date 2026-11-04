import { describe, expect, it, vi } from "vitest";
import {
  attachBatch,
  attachSummary,
  libraryPickerOptions,
} from "./attachBatch";

const photo = (n: number) => ({ uri: `file:///p${n}`, mimeType: "image/jpeg" });
const video = (n: number) => ({ uri: `file:///v${n}`, mimeType: "video/mp4" });

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

describe("attachSummary", () => {
  // Mutation: drop the plural `s` in whatWasAdded() and "3 photos" becomes
  // "3 photo".
  it("reads as one action when everything went in", () => {
    expect(attachSummary([photo(1), photo(2), photo(3)], 0)).toEqual({
      message: "3 photos added.",
      tone: "done",
    });
    expect(attachSummary([photo(1)], 0)?.message).toBe("1 photo added.");
    expect(attachSummary([video(1), video(2)], 0)?.message).toBe(
      "2 videos added.",
    );
  });

  // Mutation: revert the mixed case to a generic "items" and this fails (and
  // copyRules.test.ts bans the word).
  it("names each kind in a mixed pick", () => {
    expect(attachSummary([photo(1), photo(2), video(1)], 0)?.message).toBe(
      "2 photos and 1 video added.",
    );
  });

  // Mutation: report only `added` (or only `failed`) and the "2 of 3" or the
  // "1 couldn't be added" half disappears.
  it("says how many went in and how many did not", () => {
    expect(attachSummary([photo(1), photo(2)], 1)).toEqual({
      message: "2 of 3 added. 1 couldn't be added.",
      tone: "error",
    });
  });

  it("names a total failure, single or many", () => {
    expect(attachSummary([], 1)?.message).toBe(
      "That file couldn't be attached.",
    );
    expect(attachSummary([], 3)?.message).toBe("Couldn't add any of the 3.");
  });

  it("stays silent when nothing was picked", () => {
    expect(attachSummary([], 0)).toBeNull();
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
