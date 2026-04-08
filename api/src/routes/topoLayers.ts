import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import { MASTER_TOPO_LAYERS } from "../constants/topoLayers";

const router = Router();

// URL base for master PMTiles files. Set TOPO_CDN_BASE_URL to a CloudFront
// distribution or public S3 URL pointing at the logjam-topo-jobs bucket.
// The master/ prefix in the bucket must allow public read (or be served
// through CloudFront) since PMTiles uses HTTP Range requests that require
// a stable, non-expiring URL.
const TOPO_CDN_BASE =
  process.env.TOPO_CDN_BASE_URL ??
  `https://${process.env.S3_BUCKET_TOPO}.s3.${process.env.AWS_REGION ?? "ap-southeast-2"}.amazonaws.com`;

// GET /topo-layers — return the master topo layer list with PMTiles URLs
router.get(
  "/",
  requireAuth,
  async (_req: AuthenticatedRequest, res: Response) => {
    const layers = MASTER_TOPO_LAYERS.map((layer) => ({
      name: layer.name,
      label: layer.label,
      format: layer.format,
      pmtilesUrl: `${TOPO_CDN_BASE}/master/${layer.name}.pmtiles`,
    }));
    res.json(layers);
  },
);

export default router;
