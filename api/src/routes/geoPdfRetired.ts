import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";

const router = Router();

// GET / — the account's GeoPDF list, which is always empty now: GeoPDFs are
// made in the browser and no job is stored (ADR 0043).
//
// A Logjam GPS build that predates that still calls this when its user taps
// "Account GeoPDFs" in Saved, and in the background for auto-download. Without
// it the tap answers "Couldn't load your GeoPDFs." instead of "No generated
// GeoPDFs on your account yet." A build is supported until three months after
// its successor ships (ADR 0022), so this stays until three months after the
// first Logjam GPS release without the list. Guard: __tests__/geoPdfRetired.test.ts.
router.get("/", requireAuth, (_req: AuthenticatedRequest, res: Response) => {
  res.json({ jobs: [] });
});

export default router;
