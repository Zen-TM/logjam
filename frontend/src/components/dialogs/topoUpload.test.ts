import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { ApiError } from "../../errors/ApiError";

const apiFetch = vi.fn();
const putToPresignedUrl = vi.fn();
vi.mock("../../placeUtils", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  putToPresignedUrl: (...args: unknown[]) => putToPresignedUrl(...args),
}));

import {
  UPLOAD_STOPPED,
  sendTopoParts,
  submitFailureMessage,
  useTopoUpload,
  type TopoJobRequest,
  type TopoUploadSession,
  routeMadeTopoJob,
} from "./topoUpload";

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
    // The API signs each part's length from the file's size.
    expect(apiFetch.mock.calls[0][1].body).toMatchObject({
      uploadId: "up-1",
      sizeBytes: 10,
    });
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

describe("sendTopoParts refusals", () => {
  // Mutation: drop isRefusal from the retry check, and each worker signs
  // again on backoff, 5 times over.
  it("stops at once when the API refuses to sign", async () => {
    apiFetch.mockRejectedValue(
      new ApiError(404, "/topo-jobs/job-1/parts", "POST"),
    );
    const run = sendTopoParts(session(), () => {}).catch((e: Error) => e);
    await vi.runAllTimersAsync();
    expect(await run).toBeInstanceOf(ApiError);
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });
});

describe("useTopoUpload", () => {
  const file = new File(["0123456789"], "lidar.zip");
  const job: TopoJobRequest = {
    tileCount: 1,
    jobName: "Katoomba",
    filename: "lidar.zip",
    settings: {},
  };
  const on = { progress: () => {}, uploaded: () => {} };

  /** The API for one job: `start` and `status` answer /start and GET. */
  function serveJob(
    start: () => unknown = () => undefined,
    status: () => string = () => "pending",
  ) {
    apiFetch.mockImplementation(
      async (
        path: string,
        opts?: { method?: string; body?: { partNumbers?: number[] } },
      ) => {
        if (path === "/topo-jobs")
          return { jobId: "job-1", uploadId: "up-1", partSize: 4 };
        if (path.endsWith("/parts"))
          return {
            parts: opts!.body!.partNumbers!.map((n) => ({
              partNumber: n,
              url: `part-${n}`,
            })),
          };
        if (path.endsWith("/start")) return start();
        if (path === "/topo-jobs/job-1" && !opts) return { status: status() };
        return undefined;
      },
    );
  }
  const calls = (method: string, path: string) =>
    apiFetch.mock.calls.filter(
      ([p, o]) => p === path && (o?.method ?? "GET") === method,
    );
  const creates = () => calls("POST", "/topo-jobs");
  const deletes = () => calls("DELETE", "/topo-jobs/job-1");

  async function submitSettled(
    submit: ReturnType<typeof useTopoUpload>["submit"],
  ) {
    let outcome: unknown;
    await act(async () => {
      const run = submit(file, job, on).then(
        (id) => id,
        (e: unknown) => e,
      );
      await vi.runAllTimersAsync();
      outcome = await run;
    });
    return outcome;
  }

  async function discardSettled(discard: () => void) {
    await act(async () => {
      discard();
      await vi.runAllTimersAsync();
    });
  }

  // Mutation: make the session check at the top of `submit` always start a
  // new job, and the second submit POSTs /topo-jobs again.
  it("a submit after a failed upload carries on the same job; discard deletes it", async () => {
    serveJob();
    putToPresignedUrl.mockImplementation(async (url: string) => {
      if (url === "part-2") throw new Error("Upload failed (network error)");
    });
    const { result } = renderHook(() => useTopoUpload());
    expect(await submitSettled(result.current.submit)).toBeInstanceOf(Error);
    expect(result.current.held).toBe(true);
    expect(await submitSettled(result.current.submit)).toBeInstanceOf(Error);
    expect(creates()).toHaveLength(1);
    expect(deletes()).toHaveLength(0);

    await discardSettled(result.current.discard);
    expect(deletes()).toHaveLength(1);
    expect(result.current.held).toBe(false);
  });

  // Mutation: decide by /start's error alone (keep the session on anything
  // under 500), and a /start whose answer is lost reports a failure for a
  // topo that is already running.
  it("a /start whose response is lost after the job launched still succeeds", async () => {
    serveJob(
      () => {
        throw new TypeError("Failed to fetch");
      },
      () => "pending",
    );
    putToPresignedUrl.mockResolvedValue(undefined);
    const { result } = renderHook(() => useTopoUpload());
    expect(await submitSettled(result.current.submit)).toBe("job-1");
  });

  // Mutation: drop `|| status === "complete"`, and a job that finished while
  // its status couldn't be read is let go as a failure, so the next Make it
  // makes a second job and sends the whole ZIP again.
  it("a held job that finished meanwhile counts as made", async () => {
    let attempt = 0;
    serveJob(
      () => {
        attempt++;
        if (attempt === 1) throw new TypeError("Failed to fetch");
        throw new ApiError(400, "/topo-jobs/job-1/start", "POST");
      },
      () => {
        if (attempt === 1) throw new TypeError("Failed to fetch");
        return "complete";
      },
    );
    putToPresignedUrl.mockResolvedValue(undefined);
    const { result } = renderHook(() => useTopoUpload());
    expect(await submitSettled(result.current.submit)).toBeInstanceOf(
      TypeError,
    );
    expect(await submitSettled(result.current.submit)).toBe("job-1");
    expect(creates()).toHaveLength(1);
    expect(result.current.held).toBe(false);
  });

  // Mutation: drop the session on any 5xx from /start, and the next submit
  // makes a second job and sends the whole ZIP again.
  it("a 5xx /start that leaves the job uploading keeps the job for the next submit", async () => {
    let refuse = true;
    serveJob(
      () => {
        if (refuse) throw new ApiError(507, "/topo-jobs/job-1/start", "POST");
      },
      () => "uploading",
    );
    putToPresignedUrl.mockResolvedValue(undefined);
    const { result } = renderHook(() => useTopoUpload());
    expect(await submitSettled(result.current.submit)).toBeInstanceOf(ApiError);
    putToPresignedUrl.mockClear();
    refuse = false;
    expect(await submitSettled(result.current.submit)).toBe("job-1");
    expect(creates()).toHaveLength(1);
    expect(putToPresignedUrl).not.toHaveBeenCalled();
  });

  // Mutation: keep the session on a 404 from /parts, and every later submit
  // asks again for the job that is gone.
  it("a job that is gone is left behind: the next submit makes a new one", async () => {
    serveJob();
    const served = apiFetch.getMockImplementation()!;
    let gone = true;
    apiFetch.mockImplementation(async (path: string, opts?: unknown) => {
      if (gone && path.endsWith("/parts"))
        throw new ApiError(404, path, "POST");
      return served(path, opts);
    });
    putToPresignedUrl.mockResolvedValue(undefined);
    const { result } = renderHook(() => useTopoUpload());
    expect(await submitSettled(result.current.submit)).toBeInstanceOf(ApiError);
    expect(result.current.held).toBe(false);
    gone = false;
    expect(await submitSettled(result.current.submit)).toBe("job-1");
    expect(creates()).toHaveLength(2);
  });
  // Mutation: drop `status !== null` from the /start catch, and a dropped
  // connection that also loses the status check makes a second job and
  // sends the whole ZIP again.
  it("a /start and status check that both fail keep the job for the next submit", async () => {
    let offline = true;
    serveJob(
      () => {
        if (offline) throw new TypeError("Failed to fetch");
      },
      () => {
        if (offline) throw new TypeError("Failed to fetch");
        return "uploading";
      },
    );
    putToPresignedUrl.mockResolvedValue(undefined);
    const { result } = renderHook(() => useTopoUpload());
    expect(await submitSettled(result.current.submit)).toBeInstanceOf(
      TypeError,
    );
    putToPresignedUrl.mockClear();
    offline = false;
    expect(await submitSettled(result.current.submit)).toBe("job-1");
    expect(creates()).toHaveLength(1);
    expect(putToPresignedUrl).not.toHaveBeenCalled();
  });

  // Mutation: read a 404 from the status check as unknown (null), and a job
  // that is gone stays held, so every later submit asks for it again.
  it("a job the status check can't find is let go", async () => {
    serveJob(
      () => {
        throw new TypeError("Failed to fetch");
      },
      () => {
        throw new ApiError(404, "/topo-jobs/job-1", "GET");
      },
    );
    putToPresignedUrl.mockResolvedValue(undefined);
    const { result } = renderHook(() => useTopoUpload());
    await submitSettled(result.current.submit);
    expect(result.current.held).toBe(false);
  });

  // Mutation: DELETE a joined upload without asking its status first, and
  // closing the dialog cancels a job that launched on a lost /start answer.
  it("discard leaves a joined upload that has launched", async () => {
    let status = "uploading";
    serveJob(
      () => {
        throw new ApiError(507, "/topo-jobs/job-1/start", "POST");
      },
      () => status,
    );
    putToPresignedUrl.mockResolvedValue(undefined);
    const { result } = renderHook(() => useTopoUpload());
    await submitSettled(result.current.submit);
    expect(result.current.held).toBe(true);
    status = "pending";
    await discardSettled(result.current.discard);
    expect(deletes()).toHaveLength(0);
  });

  // Mutation: never delete a joined upload, and closing the dialog after a
  // 5xx /start leaves the job for the 24 h sweep.
  it("discard deletes a joined upload that is still uploading", async () => {
    serveJob(
      () => {
        throw new ApiError(507, "/topo-jobs/job-1/start", "POST");
      },
      () => "uploading",
    );
    putToPresignedUrl.mockResolvedValue(undefined);
    const { result } = renderHook(() => useTopoUpload());
    await submitSettled(result.current.submit);
    expect(result.current.held).toBe(true);
    await discardSettled(result.current.discard);
    expect(deletes()).toHaveLength(1);
  });
});

describe("submitFailureMessage", () => {
  // Mutation: drop the network branch, and a dropped connection reads as the
  // generic "Couldn't reach Logjam … try again".
  it("tells a user whose connection dropped that Make it carries on", () => {
    expect(submitFailureMessage(new TypeError("Failed to fetch"), false)).toBe(
      UPLOAD_STOPPED,
    );
  });

  // Mutation: drop the ApiError check at the top of submitFailureMessage, and
  // a refusal before the upload ends reads as "The upload stopped".
  it("keeps the server's sentence when the API answered", () => {
    const refused = new ApiError(
      402,
      "/topo-jobs/job-1/parts",
      "POST",
      "Not enough processing credits.",
    );
    expect(submitFailureMessage(refused, false)).toBe(
      "Not enough processing credits.",
    );
  });
});

describe("routeMadeTopoJob", () => {
  // Mutation: track every job made, and a held job that finished meanwhile
  // sits in the in-progress list as "Couldn't be made", a row no poll ends.
  it("sends a finished job to the completed list, not the in-progress one", () => {
    const track = vi.fn();
    const finished = vi.fn();
    routeMadeTopoJob({ status: "complete" }, { track, finished });
    expect(track).not.toHaveBeenCalled();
    expect(finished).toHaveBeenCalledTimes(1);

    routeMadeTopoJob({ status: "pending" }, { track, finished });
    expect(track).toHaveBeenCalledWith({ status: "pending" });
    expect(finished).toHaveBeenCalledTimes(1);
  });
});
