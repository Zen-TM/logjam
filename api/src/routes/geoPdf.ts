import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { generateGeoPdf } from "../services/generateGeoPdf";
import type { GeoPdfConfig } from "@logjam/shared";
import { MASTER_TOPO_LAYERS } from "../constants/topoLayers";

const router = Router();

const VALID_BASE_LAYERS = new Set([
  "osm", "osm-topo", "osm-cycle",
  "six-topo", "six-base", "six-imagery",
]);

const VALID_PAPER_SIZES = new Set(["A2", "A3", "A4", "A5", "custom"]);
const VALID_OVERLAY_NAMES = new Set<string>(MASTER_TOPO_LAYERS.map(l => l.name));

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

    const pdfBuffer = await generateGeoPdf(config);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="logjam-export.pdf"',
    );
    res.send(pdfBuffer);
  },
);

export default router;
