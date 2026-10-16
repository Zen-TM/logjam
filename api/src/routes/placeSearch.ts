// Location search as you type, from the place registry (ADR 0034).
//
// Auth but no user row, like /elevation: nothing here is stored, and a lookup
// per keystroke would cost a query for nothing. The registry is public, so
// auth is not guarding the answers; it keeps this from being an open search
// service, and the per-user limiter needs a user to count.
//
// PRIVACY: the query is the sensitive part, often the name of a place the user
// would rather not publish. It travels in the body (never the URL, which the
// access log keeps), `req.body.q` is in `redactPaths`, and no log line or
// error detail here carries it. Guard: placeSearch.unit.test.ts.
import { Router, Response } from "express";
import {
  PLACE_SEARCH_MAX_RESULTS,
  say,
  searchPlaces,
  type PlaceSearchResponse,
} from "@logjam/shared";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import { AppError, malformed } from "../middleware/errorHandler";
import { placeSearchLimiter } from "../middleware/rateLimit";
import { placeIndex } from "../services/placeRegistry";

/** Longer than any place name; a longer query is cut, not refused. */
const MAX_QUERY_LENGTH = 100;

const router = Router();

router.post(
  "/",
  requireAuth,
  // After requireAuth so the limiter buckets per user, not per IP. Guard:
  // `rateLimit.unit.test.ts` ("placeSearchLimiter").
  placeSearchLimiter,
  (req: AuthenticatedRequest, res: Response) => {
    const q: unknown = req.body?.q;
    if (typeof q !== "string") throw malformed("q must be a string");
    // Never refused: anything but a number is the default, and searchPlaces
    // clamps a number to PLACE_SEARCH_MAX_RESULTS.
    const asked: unknown = req.body?.limit;
    const limit = typeof asked === "number" ? asked : PLACE_SEARCH_MAX_RESULTS;

    const registry = placeIndex();
    if (!registry) {
      throw new AppError(
        503,
        say`Location search isn't available right now. Try again in a few minutes.`,
      );
    }
    const body: PlaceSearchResponse = {
      results: searchPlaces(
        registry.index,
        q.trim().slice(0, MAX_QUERY_LENGTH),
        limit,
      ),
      version: registry.version,
    };
    res.json(body);
  },
);

export default router;
