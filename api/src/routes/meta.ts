import { Router, Request, Response } from "express";
import { getEnv } from "../lib/env";

const router = Router();

// Deliberately unauthenticated: the mobile app checks this before login (a
// stale build must learn it is stale even when its auth flow is broken), and
// the response carries no user data — same exposure class as /health. Still
// behind the global rate limiter.
router.get("/min-mobile-version", (_req: Request, res: Response) => {
  res.json({ minVersion: getEnv().MIN_MOBILE_VERSION });
});

export default router;
