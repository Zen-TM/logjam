import { Router, Request, Response } from "express";
import { getEnv } from "../lib/env";
import {
  SYNC_DELTA_MAX_LIMIT,
  SYNC_PROTOCOL,
  SYNC_PUSH_MAX_OPS,
} from "@logjam/shared";

const router = Router();

// Deliberately unauthenticated: the mobile app checks this before login (a
// stale build must learn it is stale even when its auth flow is broken), and
// the response carries no user data — same exposure class as /health. Still
// behind the global rate limiter.
router.get("/min-mobile-version", (_req: Request, res: Response) => {
  res.json({ minVersion: getEnv().MIN_MOBILE_VERSION });
});

// GET /meta — capability document (Stage 8 §10.2). Same exposure class as
// above: server-wide constants only, no user data. The sync block is what a
// client checks on foreground before relying on /sync/*. `sha` is the commit
// the running image was built from (null outside a CI-built image): the
// deploy and rollback workflows' smoke step compares it with what they
// shipped, and rollback-compat reads it to find the release prod runs.
// Guard: meta.unit.test.ts.
router.get("/", (_req: Request, res: Response) => {
  const env = getEnv();
  res.json({
    sha: env.GIT_SHA || null,
    minMobileVersion: env.MIN_MOBILE_VERSION,
    sync: {
      protocols: [SYNC_PROTOCOL],
      epoch: env.SYNC_EPOCH,
      tombstoneRetentionDays:
        env.SYNC_TOMBSTONE_TTL_MS === 0
          ? null
          : Math.floor(env.SYNC_TOMBSTONE_TTL_MS / 86_400_000),
      pushMaxOps: SYNC_PUSH_MAX_OPS,
      deltaMaxLimit: SYNC_DELTA_MAX_LIMIT,
    },
  });
});

export default router;
