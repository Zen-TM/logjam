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
