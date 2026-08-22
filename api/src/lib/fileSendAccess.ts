// "Send a copy" — validation, key derivation and the download gate.
//
// A FileSend is NOT a share. Once a recipient accepts, the file is theirs:
// permanent, editable, and impossible to take back. Nothing in this module (or
// its callers) may be worded as if a send can be revoked — see the header of
// shared/src/sharing.ts for why the two verbs stay distinct.
//
// The pure parts live here rather than in the route so they have tests: the
// filename sanitiser feeds a Content-Disposition header, the key derivation
// decides which object a confirm can point at, and the gate decides who may
// download. All three are security-relevant and none of them need Prisma.
import {
  FILE_SEND_FILENAME_MAX_LENGTH,
  FILE_SEND_MAX_BYTES,
  FILE_SEND_TTL_DAYS,
  type FileSendStatus,
} from "@logjam/shared";

import { AppError } from "../middleware/errorHandler";

/**
 * Extensions a send may carry — exactly what the mobile import paths accept.
 * `pdf` is here for GeoPDFs, which are a Saved category of their own on mobile
 * (a device-local GeoPdfImport, not a server-rendered geoPdfJob) and so reach
 * a friend as a copy rather than through the revocable Share path.
 */
const SENDABLE_EXTENSIONS = ["gpx", "kml", "geojson", "pdf"] as const;
export type SendableExtension = (typeof SENDABLE_EXTENSIONS)[number];

/**
 * The display filename, cleaned.
 *
 * Control characters are stripped because this string reaches a presigned
 * URL's `ResponseContentDisposition` (see lib/mediaPresign.ts, which strips the
 * same set for the same reason), and quotes are stripped because they would
 * close the filename token. Length is capped so one user cannot store an
 * unbounded string on a row every recipient reads.
 *
 * PRIVACY: this is the one user-supplied string on a send, and a canyon's name
 * is exactly the kind of thing that ends up in it. It must never be logged.
 */
export function sanitizeSendFilename(value: unknown): string {
  if (typeof value !== "string") {
    throw new AppError(400, "filename is required");
  }
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replace(/["\\\x00-\x1f\x7f]/g, "").trim();
  if (cleaned.length === 0) throw new AppError(400, "filename is required");
  if (cleaned.length > FILE_SEND_FILENAME_MAX_LENGTH) {
    throw new AppError(
      400,
      `filename must be at most ${FILE_SEND_FILENAME_MAX_LENGTH} characters`,
    );
  }
  return cleaned;
}

/**
 * The file's extension, narrowed to the sendable set.
 *
 * Narrowed rather than passed through because it becomes part of an S3 key: a
 * whitelist is what stops user-supplied text reaching an object path at all.
 */
export function sendableExtension(filename: string): SendableExtension {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const match = SENDABLE_EXTENSIONS.find((candidate) => candidate === ext);
  if (!match) {
    throw new AppError(
      400,
      `A sent file must be one of: ${SENDABLE_EXTENSIONS.join(", ")}`,
    );
  }
  return match;
}

/**
 * Where one send's bytes live. Derived ENTIRELY from server-side values, so a
 * client cannot point a confirm at somebody else's object (the rule
 * mediaKeys() follows in routes/media.ts).
 *
 * The `file-sends/` prefix is load-bearing: the S3 lifecycle rule that expires
 * these objects is scoped to it (infra/terraform/envs/prod/s3.tf).
 */
export function fileSendKey(
  senderId: string,
  fileSendId: string,
  extension: SendableExtension,
): string {
  return `file-sends/${senderId}/${fileSendId}/copy.${extension}`;
}

/** Declared size must be inside the cap before we sign a PUT for it. */
export function assertSendableSize(sizeBytes: unknown): number {
  if (
    typeof sizeBytes !== "number" ||
    !Number.isInteger(sizeBytes) ||
    sizeBytes <= 0
  ) {
    throw new AppError(400, "sizeBytes must be a positive integer");
  }
  if (sizeBytes > FILE_SEND_MAX_BYTES) {
    const limitMb = Math.round(FILE_SEND_MAX_BYTES / 1024 / 1024);
    throw new AppError(413, `A sent file must be under ${limitMb} MB`);
  }
  return sizeBytes;
}

/** When a send's bytes and rows stop being available. */
export function fileSendExpiresAt(now: Date = new Date()): Date {
  return new Date(now.getTime() + FILE_SEND_TTL_DAYS * 86_400_000);
}

/**
 * May this recipient download these bytes right now?
 *
 * THE GATE READS THE RECIPIENT'S ROW, never whether the S3 object exists. One
 * object serves every recipient of a send, so "declined" has to be a fact about
 * the person: the bytes are still there, and still legitimately downloadable by
 * everyone else on the same send.
 *
 * An accepted recipient stays downloadable until the TTL — they already have
 * the file, and re-offering it after a failed write costs nothing.
 */
export function canRecipientDownload(
  recipient: { status: string },
  send: { expiresAt: Date },
  now: Date = new Date(),
): boolean {
  if (recipient.status === ("declined" satisfies FileSendStatus)) return false;
  return send.expiresAt.getTime() > now.getTime();
}
