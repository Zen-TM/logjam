import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Request } from "express";
import type { AuthenticatedRequest } from "./auth";

// Prefer authenticated user sub (set by requireAuth) so per-route limiters
// applied after auth get per-user buckets. Falls back to IP for unauthenticated
// requests (e.g. global limiter mounted before per-route auth).
function userOrIpKey(req: Request): string {
  const sub = (req as AuthenticatedRequest).user?.sub;
  if (sub) return `u:${sub}`;
  return `ip:${ipKeyGenerator(req.ip ?? "")}`;
}

export const globalLimiter = rateLimit({
  windowMs: 60_000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
});

export const friendsSearchLimiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
});

export const ropeWikiHeavyLimiter = rateLimit({
  windowMs: 5 * 60_000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
});

export const userPatchLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
});
