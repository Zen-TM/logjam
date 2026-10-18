// Where a GeoPDF's rendered file lives in the topo bucket, and how it is
// handed out. The worker renders to the key; a copy into or out of a plan
// (lib/planItems.ts) writes a new one; account delete removes the
// per-job prefix (routes/users.ts).
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3 } from "../services/awsClients";
import { getEnv } from "./env";
import { geoPdfTitle } from "./geoPdfTitle";

export const TOPO_BUCKET = getEnv().S3_BUCKET_TOPO ?? "";
const PRESIGN_TTL_SECONDS = 86400; // 24h

/** The S3 key of a job's rendered PDF. Guard: geoPdfWorker.unit.test.ts. */
export function resultKeyFor(jobId: string): string {
  return `exports/geo-pdf/${jobId}/logjam-export.pdf`;
}

/**
 * The S3 key of a plan's copy of a GeoPDF. It sits outside `exports/`, which
 * the topo bucket's lifecycle rule expires after 7 days
 * (infra/terraform/envs/prod/s3.tf): a plan's GeoPDF is exempt from the
 * export TTL. Guard: __tests__/planItems.test.ts ("copies a GeoPDF with its own object").
 */
export function planResultKeyFor(jobId: string): string {
  return `plans/geo-pdf/${jobId}/logjam-export.pdf`;
}

// Derive a human download filename from the job's title, falling back to a
// date-stamped name. The stored S3 key stays the generic logjam-export.pdf
// (worker contract); only the presented download name is overridden, via the
// presigned URL's ResponseContentDisposition. Sanitised to a conservative
// ASCII-safe set so no RFC 5987 encoding is needed.
export function geoPdfDownloadFilename(
  config: unknown,
  createdAt: Date,
): string {
  const title = geoPdfTitle(config);
  const base =
    title !== null
      ? title
      : `logjam-geopdf-${createdAt.toISOString().slice(0, 10)}`;
  const safe =
    base
      .replace(/[^a-zA-Z0-9 _-]+/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "logjam-geopdf";
  return `${safe}.pdf`;
}

export async function presignResult(
  resultKey: string | null,
  filename?: string,
): Promise<{ url: string; expiresAt: string } | null> {
  if (!resultKey) return null;
  const url = await getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: TOPO_BUCKET,
      Key: resultKey,
      ...(filename
        ? { ResponseContentDisposition: `attachment; filename="${filename}"` }
        : {}),
    }),
    { expiresIn: PRESIGN_TTL_SECONDS },
  );
  const expiresAt = new Date(
    Date.now() + PRESIGN_TTL_SECONDS * 1000,
  ).toISOString();
  return { url, expiresAt };
}
