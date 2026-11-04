import { describe, expect, it, vi } from "vitest";
import { attachBatch, attachSummary } from "./attachBatch";

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
  // Mutation: drop the plural `s` in noun() and "3 photos" becomes "3 photo".
  it("reads as one action when everything went in", () => {
    expect(attachSummary([photo(1), photo(2), photo(3)], 0)).toEqual({
      text: "3 photos added.",
      tone: "info",
    });
    expect(attachSummary([photo(1)], 0)?.text).toBe("1 photo added.");
    expect(attachSummary([video(1), video(2)], 0)?.text).toBe(
      "2 videos added.",
    );
  });

  it("calls a mixed pick items", () => {
    expect(attachSummary([photo(1), video(1)], 0)?.text).toBe("2 items added.");
  });

  // Mutation: report only `added` (or only `failed`) and the "2 of 3" or the
  // "1 couldn't be read" half disappears.
  it("says how many went in and how many did not", () => {
    expect(attachSummary([photo(1), photo(2)], 1)).toEqual({
      text: "2 of 3 added. 1 couldn't be read.",
      tone: "error",
    });
  });

  it("names a total failure, single or many", () => {
    expect(attachSummary([], 1)?.text).toBe("That file couldn't be attached.");
    expect(attachSummary([], 3)?.text).toBe("None of the 3 could be read.");
  });

  it("stays silent when nothing was picked", () => {
    expect(attachSummary([], 0)).toBeNull();
  });
});
