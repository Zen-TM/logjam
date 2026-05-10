import { Router, Response } from "express";
import { S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import { MASTER_TOPO_LAYERS } from "../constants/topoLayers";
import { PMTiles } from "pmtiles";

const router = Router();

const s3 = new S3Client({ region: process.env.AWS_REGION ?? "ap-southeast-2" });
const BUCKET = process.env.S3_BUCKET_TOPO ?? "logjam-topo-jobs";

// URL base for master PMTiles files. Set TOPO_CDN_BASE_URL to a CloudFront
// distribution or public S3 URL pointing at the logjam-topo-jobs bucket.
// The master/ prefix in the bucket must allow public read (or be served
// through CloudFront) since PMTiles uses HTTP Range requests that require
// a stable, non-expiring URL.
const TOPO_CDN_BASE =
  process.env.TOPO_CDN_BASE_URL ??
  `https://${BUCKET}.s3.${process.env.AWS_REGION ?? "ap-southeast-2"}.amazonaws.com`;

/** Check if an S3 object exists. */
async function objectExists(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

/** Read the geographic bounds from a PMTiles archive header. Returns undefined on failure. */
async function readPMTilesBounds(
  url: string,
): Promise<{ north: number; south: number; east: number; west: number } | undefined> {
  try {
    const archive = new PMTiles(url);
    const h = await archive.getHeader();
    return { north: h.maxLat, south: h.minLat, east: h.maxLon, west: h.minLon };
  } catch {
    return undefined;
  }
}

// GET /topo-layers — return only master topo layers whose PMTiles files exist in S3
router.get(
  "/",
  requireAuth,
  async (_req: AuthenticatedRequest, res: Response) => {
    const checks = await Promise.all(
      MASTER_TOPO_LAYERS.map(async (layer) => ({
        layer,
        exists: await objectExists(`master/${layer.name}.pmtiles`),
      })),
    );
    const layers = await Promise.all(
      checks
        .filter((c) => c.exists)
        .map(async (c) => {
          const pmtilesUrl = `${TOPO_CDN_BASE}/master/${c.layer.name}.pmtiles`;
          const bounds = await readPMTilesBounds(pmtilesUrl);
          return {
            name: c.layer.name,
            label: c.layer.label,
            format: c.layer.format,
            pmtilesUrl,
            ...(bounds ? { bounds } : {}),
          };
        }),
    );
    res.json(layers);
  },
);

export default router;
