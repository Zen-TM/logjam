// Per-file rate-limit gate for the integration suite (vitest setupFiles).
//
// The API's in-process globalLimiter runs BEFORE route-level auth, so its
// userOrIpKey falls back to the client IP — every test request, whichever
// seeded actor it authenticates as, draws from ONE shared 300-req/60s bucket.
// The suite's total demand exceeds a single window, so an unthrottled
// run always ends in 429s.
//
// Fix at the consumer: vitest runs files sequentially (fileParallelism: false
// in vitest.config.ts) and, before each file, this gate probes the limiter's
// standard headers. When the remaining budget can't cover the hungriest file,
// it sleeps until the fixed window resets. Costs one request per file and at
// most a couple of 60s waits per full run.

import { afterAll, beforeAll, expect } from "vitest";

const API_URL = process.env.API_URL ?? "http://localhost:8080";

/**
 * The SECOND limiter, and the one this gate cannot see: `userPatchLimiter`
 * (30 requests / 60s) sits on the write routes — /users/me, /custom-fields,
 * /place-types — and is keyed per user. A write-heavy file spends it in
 * seconds, and the next file to write starts with nothing left, whatever the
 * global budget says.
 *
 * The gate above cannot help: it probes a READ route, so it reports the global
 * budget and nothing about this one. Files that write in bulk call this
 * instead, which reads the budget off the response they just got and, on a
 * 429, sleeps to the window reset and hands the request back to be retried —
 * the same thing a client would do, rather than presenting a 429 as an
 * assertion failure about place types.
 */
export async function throttleWrites(res: {
  status: number;
  headers: Record<string, string>;
}): Promise<boolean> {
  const remaining = Number(res.headers["ratelimit-remaining"] ?? "99");
  const reset = Number(res.headers["ratelimit-reset"] ?? "60");
  if (res.status === 429) {
    await new Promise((resolve) => setTimeout(resolve, (reset + 1) * 1000));
    return true; // retry me
  }
  if (remaining <= 3) {
    await new Promise((resolve) => setTimeout(resolve, (reset + 1) * 1000));
  }
  return false;
}

// Upper bound on any single test file's request count. Keep ABOVE the real max
// or a file can start with too little budget and 429 mid-file. The afterAll
// below fails a file that spends more, so a file that outgrows this fails with
// that message instead of 429ing at random.
const FILE_BUDGET = 130;

// Files that already send more than FILE_BUDGET, each with a ceiling a little
// over what it sends today (so growth still fails). None fits the default
// 300-request window, let alone a share of it: they pass only because CI and
// the local slot raise RATE_LIMIT_GLOBAL_MAX, which is why the gate above
// never sleeps there. Splitting a file, or raising FILE_BUDGET, removes its
// entry.
const OVER_BUDGET: Record<string, number> = {
  "placeCopy.test.ts": 170,
  "replaceTrack.test.ts": 165,
  "planItems.test.ts": 370,
};

// Sleeping to the window reset takes up to ~61s; leave headroom.
const GATE_TIMEOUT_MS = 90_000;

async function probe() {
  const res = await fetch(`${API_URL}/trips`, {
    headers: { Authorization: "Bearer fake-token" },
  });
  return {
    status: res.status,
    remaining: Number(res.headers.get("ratelimit-remaining") ?? "0"),
    resetSeconds: Number(res.headers.get("ratelimit-reset") ?? "60"),
    at: Date.now(),
  };
}

let opened: Awaited<ReturnType<typeof probe>> | undefined;

beforeAll(async () => {
  let first = await probe();
  if (first.status === 429 || first.remaining < FILE_BUDGET) {
    await new Promise((resolve) =>
      setTimeout(resolve, (first.resetSeconds + 1) * 1000),
    );
    first = await probe();
  }
  opened = first;
}, GATE_TIMEOUT_MS);

// The file's own spend: what the window had left when it began less what is
// left now, minus the probe that reads it. Not measurable once the window has
// rolled over in between, so a file that outlives one is not checked; the
// budget is a bound on the common case, the gate's sleep covers the rest.
afterAll(async () => {
  if (!opened) return;
  const closed = await probe();
  const rolledOver = closed.at - opened.at >= opened.resetSeconds * 1000;
  const spent = opened.remaining - closed.remaining - 1;
  const file = (expect.getState().testPath ?? "").split("/").pop() ?? "";
  const limit = OVER_BUDGET[file] ?? FILE_BUDGET;
  if (!rolledOver && spent > limit) {
    throw new Error(
      `${file} sent ${spent} requests through the shared rate limit, over ` +
        `${limit}: FILE_BUDGET (${FILE_BUDGET}) or its OVER_BUDGET entry in ` +
        "src/__tests__/_rateLimitGate.ts, which the gate's wait assumes no " +
        "file exceeds. Split the file; raising the number is for a file that " +
        "cannot be split, and the window holds 300 requests.",
    );
  }
}, GATE_TIMEOUT_MS);
