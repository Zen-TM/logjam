// What a confirm reads off a presigned upload: the media bucket, the URL's
// lifetime, and the object's real size, which is the one to charge and cap
// (a client's declared size is only what the presign signed into the PUT).
import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { say } from "@logjam/shared";
import { AppError } from "../middleware/errorHandler";
import { s3 } from "../services/awsClients";
import { getEnv } from "./env";
import { deleteS3KeysBestEffort } from "./s3Cleanup";

export const MEDIA_BUCKET = getEnv().S3_BUCKET_MEDIA ?? "";
export const UPLOAD_URL_TTL_SECONDS = 900; // 15 minutes

/**
 * The size of the object at `key`: 400 when it was never uploaded, and 413,
 * after removing `cleanupKeys` (best effort: the 413 is the answer, a failed
 * cleanup must not mask it), when it is over `cap`.
 */
export async function uploadedSize(
  key: string,
  cap: number,
  cleanupKeys: string[],
): Promise<number> {
  let bytes: number;
  try {
    const head = await s3.send(
      new HeadObjectCommand({ Bucket: MEDIA_BUCKET, Key: key }),
    );
    bytes = head.ContentLength ?? 0;
  } catch {
    throw new AppError(400, say`That file didn't finish uploading. Try again.`);
  }
  if (bytes > cap) {
    await deleteS3KeysBestEffort(MEDIA_BUCKET, cleanupKeys);
    const limitMb = Math.round(cap / 1024 / 1024);
    throw new AppError(
      413,
      say`That file is too big. The limit is ${limitMb} MB.`,
    );
  }
  return bytes;
}
