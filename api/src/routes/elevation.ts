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
import { AppError } from "../middleware/errorHandler";
import {
  buildElevationProfile,
  densifyLineSegments,
  MAX_ROUTE_POINTS,
  parseRoutePoints,
  ROUTE_ERRORS,
  type RoutePoint,
} from "@logjam/shared";
import { DEM_ATTRIBUTION, sampleElevations } from "../services/elevation";

const router = Router();

// ── POST /elevation/profile ───────────────────────────────────
// Body: { points: [[lon, lat], ...] }        — a single line (routes, web)
//   or  { segments: [[[lon, lat], ...], ...] } — a multi-segment track
// Returns evenly spaced samples along the line(s) plus gain/loss.
router.post(
  "/profile",
  requireAuth,
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
        throw new AppError(400, ROUTE_ERRORS.pointsRequired);
      }
      segments = [];
      for (const segment of req.body.segments) {
        const parsed = parseRoutePoints(segment);
        if ("error" in parsed) throw new AppError(400, parsed.error);
        segments.push(parsed.points);
      }
    } else {
      const parsed = parseRoutePoints(req.body?.points);
      if ("error" in parsed) throw new AppError(400, parsed.error);
      segments = [parsed.points];
    }
    const totalPoints = segments.reduce((n, segment) => n + segment.length, 0);
    if (totalPoints > MAX_ROUTE_POINTS) {
      throw new AppError(400, ROUTE_ERRORS.tooManyPoints);
    }

    const positions = densifyLineSegments(segments);
    const elevations = await sampleElevations(positions);
    const profile = buildElevationProfile(positions, elevations);

    res.json({ ...profile, attribution: DEM_ATTRIBUTION });
  },
);

export default router;
