// Per-file rate-limit gate for the integration suite (vitest setupFiles).
//
// The API's in-process globalLimiter runs BEFORE route-level auth, so its
// userOrIpKey falls back to the client IP — every test request, whichever
// seeded actor it authenticates as, draws from ONE shared 300-req/60s bucket.
// The suite's total demand now exceeds a single window, so an unthrottled
// parallel run always ends in 429s.
//
// Fix at the consumer: vitest runs files sequentially (fileParallelism: false
// in vitest.config.ts) and, before each file, this gate probes the limiter's
// standard headers. When the remaining budget can't cover the hungriest file,
// it sleeps until the fixed window resets. Costs one request per file and at
// most a couple of 60s waits per full run.

import { beforeAll } from "vitest";

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

// Upper bound on any single test file's request count (tripLogsGlobal is the
// hungriest at ~95). Keep ABOVE the real max or a file can start with too
// little budget and 429 mid-file.
const FILE_BUDGET = 130;

// Sleeping to the window reset takes up to ~61s; leave headroom.
const GATE_TIMEOUT_MS = 90_000;

beforeAll(async () => {
  const res = await fetch(`${API_URL}/trips`, {
    headers: { Authorization: "Bearer fake-token" },
  });
  const remaining = Number(res.headers.get("ratelimit-remaining") ?? "0");
  const resetSeconds = Number(res.headers.get("ratelimit-reset") ?? "60");
  if (res.status === 429 || remaining < FILE_BUDGET) {
    await new Promise((resolve) =>
      setTimeout(resolve, (resetSeconds + 1) * 1000),
    );
  }
}, GATE_TIMEOUT_MS);
