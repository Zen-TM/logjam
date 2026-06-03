import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { generateGeoPdf } from "../services/generateGeoPdf";
import type { GeoPdfConfig, VectorStyleSettings } from "@logjam/shared";
import { validateVectorStyleSettings, VECTOR_STYLE_DEFAULTS } from "@logjam/shared";
import { TOPO_LAYERS } from "../constants/topoLayers";
import prisma from "../services/prisma";

const router = Router();

const VALID_BASE_LAYERS = new Set([
  "osm", "osm-topo", "osm-cycle",
  "six-topo", "six-base", "six-imagery",
]);

const VALID_PAPER_SIZES = new Set(["A2", "A3", "A4", "A5", "custom"]);
const VALID_OVERLAY_NAMES = new Set<string>(TOPO_LAYERS.map(l => l.name));

router.post(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    // 120-second timeout for large area generation
    req.setTimeout(120_000);

    const config = req.body as GeoPdfConfig;

    // Validate required fields
    if (!config.extent || !config.baseLayer || !config.paperSize) {
      throw new AppError(400, "Missing required fields: extent, baseLayer, paperSize");
    }
    if (!VALID_PAPER_SIZES.has(config.paperSize)) {
      throw new AppError(400, `Invalid paper size: ${config.paperSize}`);
    }
    if (!VALID_BASE_LAYERS.has(config.baseLayer)) {
      throw new AppError(400, `Invalid base layer: ${config.baseLayer}`);
    }
    const { north, south, east, west } = config.extent;
    if (north <= south || east <= west) {
      throw new AppError(400, "Invalid extent: north must be > south and east must be > west");
    }
    if (!config.scale || config.scale <= 0) {
      throw new AppError(400, "Invalid scale");
    }
    if (Array.isArray(config.overlays)) {
      for (const name of config.overlays) {
        if (!VALID_OVERLAY_NAMES.has(name)) {
          throw new AppError(400, `Invalid overlay name: ${name}`);
        }
      }
    }
    if (Array.isArray(config.canyonMarkers)) {
      for (const m of config.canyonMarkers) {
        if (typeof m.lat !== "number" || typeof m.lon !== "number" ||
            typeof m.name !== "string" || (m.color !== "owned" && m.color !== "shared")) {
          throw new AppError(400, "Invalid canyon marker entry");
        }
      }
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
