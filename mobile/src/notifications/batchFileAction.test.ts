// A run where six of eight files landed is neither "saved" nor "failed", and
// the sentence is the whole point of this module.
import { describe, expect, it, vi } from "vitest";

import type { TNotification } from "../api/types";
import { batchFileActionMessage, runBatchFileAction } from "./batchFileAction";

function sent(id: string): TNotification {
  return {
    id,
    type: "file_sent",
    read: false,
    createdAt: "2026-08-30T01:00:00.000Z",
    payload: { fileSendId: `fs-${id}`, sentById: "bob" },
  } as TNotification;
}

describe("runBatchFileAction", () => {
  it("runs in order, one at a time", async () => {
    const order: string[] = [];
    const progress: number[] = [];
    const result = await runBatchFileAction({
      items: [sent("a"), sent("b"), sent("c")],
      run: async (n) => {
        order.push(n.id);
      },
      onProgress: (p) => progress.push(p.done),
    });
    expect(order).toEqual(["a", "b", "c"]);
    expect(progress).toEqual([0, 1, 2]);
    expect(result).toEqual({ done: 3, failed: 0, total: 3 });
  });

  it("carries on past one file's failure — the rest of the batch is still worth having", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const run = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("no signal"))
      .mockResolvedValueOnce(undefined);
    const result = await runBatchFileAction({
      items: [sent("a"), sent("b"), sent("c")],
      run,
      onProgress: () => {},
    });
    expect(run).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ done: 2, failed: 1, total: 3 });
  });
});

describe("batchFileActionMessage", () => {
  it("reports a clean run plainly, and says where the files went", () => {
    expect(
      batchFileActionMessage({ kind: "accept", done: 8, failed: 0, total: 8 }),
    ).toEqual({ text: "Saved 8 files — find them in Saved.", tone: "info" });
  });

  it("reports a PARTIAL run as an error, because the rest is the user's problem now", () => {
    const report = batchFileActionMessage({
      kind: "accept",
      done: 6,
      failed: 2,
      total: 8,
    });
    expect(report.tone).toBe("error");
    expect(report.text).toContain("Saved 6 of 8");
    expect(report.text).toContain("2 files couldn't be saved");
  });

  it("has its own words for a run where nothing landed", () => {
    expect(
      batchFileActionMessage({ kind: "accept", done: 0, failed: 3, total: 3 }),
    ).toEqual({ text: "Couldn't save 3 files.", tone: "error" });
  });

  it("keeps the decline verb distinct — it is never 'saved'", () => {
    expect(
      batchFileActionMessage({ kind: "decline", done: 4, failed: 0, total: 4 }).text,
    ).toBe("Turned down 4 files.");
  });

  it("says one file, not 1 files", () => {
    expect(
      batchFileActionMessage({ kind: "accept", done: 1, failed: 0, total: 1 }).text,
    ).toBe("Saved 1 file — find it in Saved.");
  });
});
