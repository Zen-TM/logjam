// Pre-submit cost estimate, for the LiDAR topo pipeline.
//
// Every dialog that launches a worker needs to answer the same question before
// the user commits: "what will this cost me, and have I got it?" One endpoint
// rather than three, because the answer is assembled from the same two pieces
// in every case — the pipeline's own adaptive runtime estimator, and the
// caller's monthly credit balance.
//
// Read-only: nothing is reserved, so an estimate never has to be released.

import { Router, Response } from "express";
import { z } from "zod";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import { malformed } from "../middleware/errorHandler";
import { resolveUser as getUser } from "../lib/resolveUser";
import { getMonthlyCreditUsage } from "../lib/computeCredits";
import { estimateTopoSeconds } from "../lib/runtimeEstimates";
import { estimateCredits } from "@logjam/shared";

const router = Router();

const requestSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("topo"),
    tileCount: z.number().int().nonnegative().nullable(),
  }),
]);

// POST /compute-estimate — what a job would cost, and what's left this month
router.post(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await getUser(req.user!.sub);

    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw malformed(
        parsed.error.issues[0]?.message ?? "Invalid estimate request",
      );
    }
    const request = parsed.data;

    let estimatedSeconds: number | null = null;

    switch (request.kind) {
      case "topo":
        estimatedSeconds = await estimateTopoSeconds(request.tileCount);
        break;
    }

    const usage = await getMonthlyCreditUsage(
      user.id,
      user.monthlyComputeCredits,
    );
    const credits = estimateCredits(request.kind, estimatedSeconds);

    res.json({
      estimatedSeconds,
      // null = the adaptive estimator has too little history to have an opinion.
      // Clients must render that as "unknown", never as "free".
      credits,
      used: usage.used,
      quota: usage.quota,
      remaining: usage.remaining,
      resetAt: usage.resetAt,
      // Whether submitting would be refused, so a dialog can disable its button
      // instead of letting the user find out via a 429.
      wouldExceed:
        usage.used >= usage.quota ||
        (credits !== null && usage.used + credits > usage.quota),
    });
  },
);

export default router;
