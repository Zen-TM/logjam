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
import prisma from "../services/prisma";

const router = Router();

router.post(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
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
    const userRow = await prisma.user.findUnique({
      where: { cognitoId: req.user!.sub },
      select: { id: true, vectorStyle: true },
    });
    if (!userRow) throw new AppError(404, "User not found");

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
  },
);

export default router;
