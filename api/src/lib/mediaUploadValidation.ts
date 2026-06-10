import { AppError } from "../middleware/errorHandler";
import {
  MEDIA_SIZE_CAPS,
  categoryHasThumbnail,
  type MediaCategory,
} from "@logjam/shared";

export interface ValidatedUploadSizes {
  sizeBytes: number;
  thumbnailSizeBytes: number | null;
}

function assertPositiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new AppError(400, `${field} must be a positive integer`);
  }
  return value;
}

/**
 * Validate the client-declared upload sizes for a presign request (SEC-003).
 * The declared sizes bound the presigned PUT via a signed Content-Length —
 * without them a client could upload arbitrarily large objects and never
 * confirm, orphaning off-quota bytes. Caps mirror the authoritative
 * confirm-time check against the real S3 object size.
 */
export function validateUploadSizes(
  category: MediaCategory,
  sizeBytes: unknown,
  thumbnailSizeBytes: unknown,
): ValidatedUploadSizes {
  const cap = MEDIA_SIZE_CAPS[category];
  const size = assertPositiveInteger(sizeBytes, "sizeBytes");
  if (size > cap) {
    const limitMb = Math.round(cap / 1024 / 1024);
    throw new AppError(
      413,
      `File exceeds the ${limitMb} MB limit for ${category}s`,
    );
  }

  if (!categoryHasThumbnail(category)) {
    if (thumbnailSizeBytes !== undefined && thumbnailSizeBytes !== null) {
      throw new AppError(400, `${category}s do not carry a thumbnail`);
    }
    return { sizeBytes: size, thumbnailSizeBytes: null };
  }

  const thumbCap = MEDIA_SIZE_CAPS.image;
  const thumbSize = assertPositiveInteger(
    thumbnailSizeBytes,
    "thumbnailSizeBytes",
  );
  if (thumbSize > thumbCap) {
    const limitMb = Math.round(thumbCap / 1024 / 1024);
    throw new AppError(413, `Thumbnail exceeds the ${limitMb} MB limit`);
  }
  return { sizeBytes: size, thumbnailSizeBytes: thumbSize };
}
