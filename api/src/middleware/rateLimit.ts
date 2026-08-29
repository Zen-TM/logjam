import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Request } from "express";
import type { AuthenticatedRequest } from "./auth";

// SINGLE-INSTANCE ASSUMPTION (ARCH-007).
//
// Every limiter below uses express-rate-limit's default in-process MemoryStore
// (no `store` configured). The counters live in this process's memory, so the
// limits are only correct while exactly ONE API instance runs — which holds
// today (single EB container per api/Dockerrun.aws.json). A container restart
// also resets all counters.
//
// If the deployment ever scales horizontally (multiple EB instances, or an ECS
// service with >1 task), each instance keeps its own counters and every limit
// is silently multiplied by the instance count — making the abuse caps
// (friendsSearchLimiter / ropeWikiHeavyLimiter) ineffective. The fix at that
// point is a shared store: back these with `rate-limit-redis` against
// ElastiCache. Do NOT add Redis pre-emptively; the trigger is the move to >1
// instance.

// Prefer authenticated user sub (set by requireAuth) so per-route limiters
// applied after auth get per-user buckets. Falls back to IP for unauthenticated
// requests (e.g. global limiter mounted before per-route auth).
function userOrIpKey(req: Request): string {
  const sub = (req as AuthenticatedRequest).user?.sub;
  if (sub) return `u:${sub}`;
  return `ip:${ipKeyGenerator(req.ip ?? "")}`;
}

// Production ceiling for the global limiter. Not a knob in prod: see
// globalLimitMax().
const GLOBAL_MAX_DEFAULT = 300;

// CI-only headroom for the global limiter.
//
// The integration suite (api/src/__tests__, ~250 tests) runs every actor
// through ONE bucket — this limiter mounts before requireAuth, so userOrIpKey
// always falls back to the runner's IP — and a full run's demand exceeds a
// single 300/60s window. RATE_LIMIT_GLOBAL_MAX raises the cap for that run.
//
// Fail-closed, same shape as the AUTH_MODE=fake guard in lib/env.ts: the
// override is IGNORED whenever NODE_ENV=production, so a stray value in a prod
// environment can never widen the real abuse cap. Read straight from
// process.env (not getEnv()) because this module is imported while index.ts is
// still wiring up; the var is declared in lib/env.ts so it is still validated
// and listed at boot. Covered by rateLimit.unit.test.ts.
export function globalLimitMax(env: NodeJS.ProcessEnv = process.env): number {
  if (env.NODE_ENV === "production") return GLOBAL_MAX_DEFAULT;
  const override = Number(env.RATE_LIMIT_GLOBAL_MAX);
  return Number.isInteger(override) && override > 0
    ? override
    : GLOBAL_MAX_DEFAULT;
}

export const globalLimiter = rateLimit({
  windowMs: 60_000,
  max: globalLimitMax(),
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

// Protomaps region clips cost real S3 range-read work per call (stage4a §7.1).
export const regionClipLimiter = rateLimit({
  windowMs: 60 * 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
});

// Elevation profiles fan out to DEM tile fetches over the network per request
// (services/elevation.ts), so cost scales with the bbox a caller asks for, not
// with request count. Interactive though — the measure tool and route editor
// re-request on edit — so this is a ceiling on sustained fan-out, not a
// regionClip-style hard cap.
export const elevationLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
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
