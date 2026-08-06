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
  densifyLine,
  parseRoutePoints,
} from "@logjam/shared";
import { DEM_ATTRIBUTION, sampleElevations } from "../services/elevation";

const router = Router();

// ── POST /elevation/profile ───────────────────────────────────
// Body: { points: [[lon, lat], ...] }
// Returns evenly spaced samples along the line plus gain/loss.
router.post(
  "/profile",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    // Reuses the route point parser so the accepted geometry — shape, bounds
    // and the MAX_ROUTE_POINTS ceiling — is defined in exactly one place, and
    // so the measure tool cannot ask for a profile a route could not hold.
    const parsed = parseRoutePoints(req.body?.points);
    if ("error" in parsed) throw new AppError(400, parsed.error);

    const positions = densifyLine(parsed.points);
    const elevations = await sampleElevations(positions);
    const profile = buildElevationProfile(positions, elevations);

    res.json({ ...profile, attribution: DEM_ATTRIBUTION });
  },
);

export default router;
