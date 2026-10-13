// Elevation profiles, derived on demand from a point list plus the DEM.
//
// Deliberately stateless: nothing here reads or writes the database, and no
// profile is ever persisted. Route geometry is the single source of truth —
// a stored profile would go stale the instant a vertex moved. See
// shared/src/elevation.ts.
//
// Auth is required even though the endpoint owns no user data, because the
// REQUEST is the sensitive part: the body is a wilderness route line. An
// unauthenticated caller must not be able to use us as an elevation proxy.
import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import { malformed } from "../middleware/errorHandler";
import { elevationLimiter } from "../middleware/rateLimit";
import {
  buildElevationProfile,
  demCredits,
  densifyLineSegments,
  ELEVATION_PROFILE_MAX_SAMPLES,
  ELEVATION_TRACK_MAX_SAMPLES,
  MAX_ROUTE_POINTS,
  parseRoutePoints,
  ROUTE_ERRORS,
  type RoutePoint,
} from "@logjam/shared";
import { sampleElevations } from "../services/elevation";

const router = Router();

// ── POST /elevation/profile ───────────────────────────────────
// Body: { points: [[lon, lat], ...] }        — a single line (routes, web)
//   or  { segments: [[[lon, lat], ...], ...] } — a multi-segment track
//   and optionally { maxSamples } — a track asks for a higher sample ceiling
//   than a drawn line gets, capped at ELEVATION_TRACK_MAX_SAMPLES.
// Returns evenly spaced samples along the line(s) plus gain/loss.
router.post(
  "/profile",
  requireAuth,
  // After requireAuth so the limiter buckets per user, not per IP.
  elevationLimiter,
  async (req: AuthenticatedRequest, res: Response) => {
    // Reuses the route point parser so the accepted geometry — shape, bounds
    // and the MAX_ROUTE_POINTS ceiling — is defined in exactly one place, and
    // so the measure tool cannot ask for a profile a route could not hold.
    // A track arrives as segments: each segment is parsed like a line, and the
    // total vertex count is capped the same way, so a pause gap is never
    // sampled as travelled ground.
    let segments: RoutePoint[][];
    if (Array.isArray(req.body?.segments)) {
      if (req.body.segments.length === 0) {
        throw malformed(ROUTE_ERRORS.pointsRequired);
      }
      segments = [];
      for (const segment of req.body.segments) {
        const parsed = parseRoutePoints(segment);
        if ("error" in parsed) throw malformed(parsed.error);
        segments.push(parsed.points);
      }
    } else {
      const parsed = parseRoutePoints(req.body?.points);
      if ("error" in parsed) throw malformed(parsed.error);
      segments = [parsed.points];
    }
    const totalPoints = segments.reduce((n, segment) => n + segment.length, 0);
    if (totalPoints > MAX_ROUTE_POINTS) {
      throw malformed(ROUTE_ERRORS.tooManyPoints);
    }

    // Clamped, never refused: a caller that sends nothing, or nonsense, gets
    // the default ceiling, and none can make one request read more than a
    // track's.
    const asked: unknown = req.body?.maxSamples;
    const maxSamples =
      typeof asked === "number" && Number.isInteger(asked) && asked >= 2
        ? Math.min(asked, ELEVATION_TRACK_MAX_SAMPLES)
        : ELEVATION_PROFILE_MAX_SAMPLES;
    const positions = densifyLineSegments(segments, maxSamples);
    const profile = buildElevationProfile(
      positions,
      await sampleElevations(positions),
    );

    res.json({
      ...profile,
      attribution: demCredits(profile.demSourceIds).join(" "),
    });
  },
);

export default router;
