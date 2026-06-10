import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { generateGeoPdf } from "../services/generateGeoPdf";
import type { GeoPdfConfig, VectorStyleSettings } from "@logjam/shared";
import {
  validateVectorStyleSettings,
  VECTOR_STYLE_DEFAULTS,
  validateGeoPdfConfig,
} from "@logjam/shared";
import { resolveUser } from "../lib/resolveUser";

const router = Router();

// ── GeoPDF concurrency bound (ARCH-006) ─────────────────────────────────────
//
// GeoPDF generation runs SYNCHRONOUSLY in this request handler: generateGeoPdf
// fetches many map tiles over HTTP and renders onto a server-side canvas, up to
// ~120 s of CPU + network fan-out, in-process on the single Elastic Beanstalk
// API container. This is the one heavy job that is NOT offloaded to an ECS
// worker (unlike the topo raster pipeline and on-demand topo exports).
//
// Moving it to the async-job/worker pattern is the architecturally clean fix
// but is real new infra and is deferred until load justifies it. Until then,
// bound the number of concurrent generations so a burst of requests can't
// saturate the single instance's event loop / memory and degrade all other API
// traffic. Excess requests are rejected with 503 (retryable) rather than queued
// — queuing behind a 120 s job risks the ALB/EB idle timeout.
//
// NOTE (single-instance assumption, cf. ARCH-007): this counter is per-process.
// It is correct for the current single-container deployment; horizontal
// scale-out multiplies the effective cap by the instance count.
const MAX_CONCURRENT_GEO_PDF = 2;
let activeGeoPdfRenders = 0;

router.post(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    // Acquire a concurrency slot atomically (check + increment with no await
    // in between, so two near-simultaneous requests can't both pass the check).
    if (activeGeoPdfRenders >= MAX_CONCURRENT_GEO_PDF) {
      throw new AppError(
        503,
        "The server is busy generating other maps. Please try again in a moment.",
      );
    }
    activeGeoPdfRenders += 1;
    try {
      // 120-second timeout for large area generation
      req.setTimeout(120_000);

      const config = req.body as GeoPdfConfig;

      const configError = validateGeoPdfConfig(config);
      if (configError) {
        throw new AppError(400, configError);
      }

      // Resolve the authenticated user's UUID so the GeoPDF service can scope
      // its per-job overlay lookups to this user's completed topo jobs only.
      // Load the live vector style too so the exported LiDAR topo matches the
      // on-screen MapLibre overlay.
      const userRow = await resolveUser(req.user!.sub);

      // null = new user with no saved style → defaults (same as GET /vector-style
      // and the overlay fallback). Invalid stored JSON → warn + defaults.
      let vectorStyle: VectorStyleSettings = VECTOR_STYLE_DEFAULTS;
      if (userRow.vectorStyle != null) {
        const result = validateVectorStyleSettings(userRow.vectorStyle);
        if (result.ok) {
          vectorStyle = result.value;
        } else {
          console.warn(`GeoPDF: invalid stored vector style for user, using defaults: ${result.errors.join("; ")}`);
        }
      }

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", 'attachment; filename="logjam-export.pdf"');
      res.setHeader("Cache-Control", "no-store");
      res.flushHeaders();

      const pdfBuffer = await generateGeoPdf(config, userRow.id, vectorStyle);
      res.end(pdfBuffer);
    } finally {
      activeGeoPdfRenders -= 1;
    }
  },
);

export default router;
