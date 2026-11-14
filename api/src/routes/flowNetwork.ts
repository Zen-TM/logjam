// How much land drains through a point: Logjam Web's click-anywhere catchment.
// See shared/src/flowNetwork.ts for the contract and services/flowNetwork.ts
// for the layer it reads.
//
// Auth without resolveUser, as /elevation: nothing here reads or writes a
// user's rows, so there is no internal user to look up, but the REQUEST is the
// sensitive part (where someone is looking), and an unauthenticated caller
// must not be able to use us as a catchment proxy.
import { Router, Response } from "express";
import { isValidLatitude, isValidLongitude } from "@logjam/shared";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import { malformed } from "../middleware/errorHandler";
import { flowNetworkLimiter } from "../middleware/rateLimit";
import { lookupFlowNetwork } from "../services/flowNetwork";

const router = Router();

// ── POST /flow-network/lookup ─────────────────────────────────
// Body: FlowNetworkLookupRequest. The point is in the body, never the URL,
// which access logs keep.
router.post(
  "/lookup",
  requireAuth,
  // After requireAuth so the limiter buckets per user, not per IP.
  flowNetworkLimiter,
  async (req: AuthenticatedRequest, res: Response) => {
    const { longitude, latitude, upstream } = req.body ?? {};
    // The details name the field, never its value: they are logged.
    if (!isValidLongitude(longitude)) {
      throw malformed("longitude must be a number from -180 to 180");
    }
    if (!isValidLatitude(latitude)) {
      throw malformed("latitude must be a number from -90 to 90");
    }
    if (upstream !== undefined && typeof upstream !== "boolean") {
      throw malformed("upstream must be a boolean when present");
    }
    res.json(await lookupFlowNetwork([longitude, latitude], upstream === true));
  },
);

export default router;
