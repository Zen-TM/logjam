import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  HeadObjectCommand,
  ListPartsCommand,
  UploadPartCommand,
  type Part,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { TOPO_UPLOAD_PART_URL_TTL_SECONDS, say } from "@logjam/shared";
import { s3 } from "../services/awsClients";
import { AppError, malformed } from "../middleware/errorHandler";
import { abortS3MultipartUploads, deleteS3Prefix } from "./s3Cleanup";

// Compressed input-ZIP cap: bounds wasted S3 transfer and storage. A typical
// ELVIS export (tens of tiles, ~22 MB each) is far below it.
export const MAX_INPUT_ZIP_COMPRESSED_BYTES = 25 * 1024 * 1024 * 1024; // 25 GB

// Logjam Web sends the ZIP as an S3 multipart upload in parts of this size, so
// a dropped connection costs one part, not the file. 32 MiB keeps the cap to
// 800 parts, well under S3's 10,000.
export const TOPO_UPLOAD_PART_BYTES = 32 * 1024 * 1024;
export const TOPO_UPLOAD_MAX_PARTS = Math.ceil(
  MAX_INPUT_ZIP_COMPRESSED_BYTES / TOPO_UPLOAD_PART_BYTES,
);

const PART_MISSING = say`Part of that ZIP didn't upload. Try again.`;

/** Presigned PUT URLs for parts of a ZIP of `sizeBytes`. Each signs its
 *  part's exact length, so no part outgrows TOPO_UPLOAD_PART_BYTES, and a size
 *  over the cap is refused, so the parts together cannot pass it whatever size
 *  a client claims. Guards: the signTopoParts cases in topoUpload.unit.test.ts,
 *  and the X-Amz-SignedHeaders check in __tests__/topoJobs.test.ts. */
export async function signTopoParts(
  bucket: string,
  key: string,
  uploadId: string,
  sizeBytes: number,
  partNumbers: number[],
): Promise<{ partNumber: number; url: string }[]> {
  if (sizeBytes > MAX_INPUT_ZIP_COMPRESSED_BYTES)
    throw new AppError(
      413,
      say`That ZIP is larger than Logjam can take. Choose a smaller area.`,
    );
  const partCount = Math.ceil(sizeBytes / TOPO_UPLOAD_PART_BYTES);
  for (const n of partNumbers) {
    if (!Number.isInteger(n) || n < 1 || n > partCount)
      throw malformed("partNumbers must be integers in range");
  }
  return Promise.all(
    partNumbers.map(async (partNumber) => ({
      partNumber,
      url: await getSignedUrl(
        s3,
        new UploadPartCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
          PartNumber: partNumber,
          ContentLength: Math.min(
            TOPO_UPLOAD_PART_BYTES,
            sizeBytes - (partNumber - 1) * TOPO_UPLOAD_PART_BYTES,
          ),
        }),
        { expiresIn: TOPO_UPLOAD_PART_URL_TTL_SECONDS },
      ),
    })),
  );
}

const isNoSuchUpload = (err: unknown) =>
  (err as { name?: string }).name === "NoSuchUpload";

/** The upload is gone: joined already (a retry after a lost response, or a
 *  second join racing the first) when the ZIP is there, else aborted. */
async function confirmJoined(bucket: string, key: string): Promise<void> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  } catch {
    throw new AppError(400, say`That upload expired. Choose the ZIP again.`);
  }
}

/** Joins the parts S3 holds into the ZIP. The parts come from S3, not the
 *  client, so the client never needs a part's ETag (and the bucket's CORS
 *  never has to expose it). */
export async function joinTopoUpload(
  bucket: string,
  key: string,
  uploadId: string,
  partCount: number,
): Promise<void> {
  let parts: Part[] = [];
  try {
    let marker: string | undefined;
    do {
      const page = await s3.send(
        new ListPartsCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
          PartNumberMarker: marker,
        }),
      );
      parts = parts.concat(page.Parts ?? []);
      marker = page.IsTruncated ? page.NextPartNumberMarker : undefined;
    } while (marker);
  } catch (err) {
    if (!isNoSuchUpload(err)) throw err;
    return confirmJoined(bucket, key);
  }

  // Every part from 1 to partCount and nothing past it: a gap would join
  // into a ZIP with a hole in it.
  if (
    parts.length !== partCount ||
    parts.some((p, i) => p.PartNumber !== i + 1)
  )
    throw new AppError(400, PART_MISSING);
  // Full-size parts but the last, as signed. Only a client that ignored the
  // signed lengths gets here, so its upload is dropped rather than kept.
  const last = parts.length - 1;
  if (
    parts.some((p, i) =>
      i < last
        ? p.Size !== TOPO_UPLOAD_PART_BYTES
        : !p.Size || p.Size > TOPO_UPLOAD_PART_BYTES,
    )
  ) {
    await s3.send(
      new AbortMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
      }),
    );
    throw malformed("part sizes do not match the signed part size");
  }

  try {
    await s3.send(
      new CompleteMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: parts.map(({ PartNumber, ETag }) => ({ PartNumber, ETag })),
        },
      }),
    );
  } catch (err) {
    if (isNoSuchUpload(err)) return confirmJoined(bucket, key);
    const name = (err as { name?: string }).name;
    if (name === "EntityTooSmall" || name === "InvalidPart")
      throw new AppError(400, PART_MISSING);
    throw err;
  }
}

/** Removes everything a topo job has in S3. The open upload is aborted first:
 *  a join landing after the prefix delete would write a ZIP no row owns. */
export async function deleteTopoJobObjects(
  bucket: string,
  jobId: string,
): Promise<void> {
  await abortS3MultipartUploads(bucket, `inputs/${jobId}/`);
  await Promise.all(
    [`inputs/${jobId}/`, `outputs/${jobId}/`, `jobs/${jobId}/`].map((prefix) =>
      deleteS3Prefix(bucket, prefix),
    ),
  );
}
