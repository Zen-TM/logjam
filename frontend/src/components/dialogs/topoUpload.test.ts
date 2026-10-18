import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const apiFetch = vi.fn();
const putToPresignedUrl = vi.fn();
vi.mock("../../placeUtils", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  putToPresignedUrl: (...args: unknown[]) => putToPresignedUrl(...args),
}));

import { sendTopoParts, type TopoUploadSession } from "./topoUpload";

function session(): TopoUploadSession {
  // 10 bytes in parts of 4: parts 1-3, the last one 2 bytes.
  return {
    file: new File(["0123456789"], "lidar.zip"),
    jobId: "job-1",
    uploadId: "up-1",
    partSize: 4,
    done: new Set(),
    completed: false,
  };
}

// Signs `part-<n>` URLs; /complete answers nothing.
function serveApi() {
  apiFetch.mockImplementation(
    async (path: string, opts: { body: { partNumbers?: number[] } }) =>
      path.endsWith("/parts")
        ? {
            parts: opts.body.partNumbers!.map((n) => ({
              partNumber: n,
              url: `part-${n}`,
            })),
          }
        : undefined,
  );
}

const sentParts = () => putToPresignedUrl.mock.calls.map((c) => c[0]);
const completions = () =>
  apiFetch.mock.calls.filter(([path]) => path.endsWith("/complete"));

beforeEach(() => {
  vi.useFakeTimers();
  apiFetch.mockReset();
  putToPresignedUrl.mockReset();
  serveApi();
});
afterEach(() => vi.useRealTimers());

describe("sendTopoParts", () => {
  it("sends each part once and joins them", async () => {
    putToPresignedUrl.mockResolvedValue(undefined);
    const s = session();
    await sendTopoParts(s, () => {});
    expect(sentParts().sort()).toEqual(["part-1", "part-2", "part-3"]);
    expect(completions()).toEqual([
      [
        "/topo-jobs/job-1/complete",
        { method: "POST", body: { uploadId: "up-1", partCount: 3 } },
      ],
    ]);
    expect(s.completed).toBe(true);
  });

  it("retries a part that fails once, without failing the upload", async () => {
    putToPresignedUrl
      .mockRejectedValueOnce(new Error("Upload stalled"))
      .mockResolvedValue(undefined);
    const run = sendTopoParts(session(), () => {});
    await vi.runAllTimersAsync();
    await run;
    expect(putToPresignedUrl).toHaveBeenCalledTimes(4);
    expect(completions()).toHaveLength(1);
  });

  // Mutation: build the queue from every part instead of those not in
  // `done`, and the resume sends part 1 and 3 again.
  it("after a part fails every attempt, the next call sends only what is missing", async () => {
    putToPresignedUrl.mockImplementation(async (url: string) => {
      if (url === "part-2") throw new Error("Upload failed (network error)");
    });
    const s = session();
    const first = sendTopoParts(s, () => {}).catch((e: Error) => e);
    await vi.runAllTimersAsync();
    expect(await first).toBeInstanceOf(Error);
    expect([...s.done].sort()).toEqual([1, 3]);
    expect(completions()).toHaveLength(0);

    putToPresignedUrl.mockReset().mockResolvedValue(undefined);
    let last = 0;
    await sendTopoParts(s, (sent, total) => {
      last = sent;
      expect(total).toBe(10);
    });
    expect(sentParts()).toEqual(["part-2"]);
    expect(last).toBe(10);
    expect(completions()).toHaveLength(1);
  });
});
