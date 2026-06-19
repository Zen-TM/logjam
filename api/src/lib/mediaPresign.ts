import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3 } from "../services/awsClients";
import { getEnv } from "./env";
import { mediaCategory, type MediaItem, type MediaLinkedType } from "@logjam/shared";

const MEDIA_BUCKET = getEnv().S3_BUCKET_MEDIA ?? "";

// Presigned GET URLs are bearer tokens: a leaked link works until it expires.
// Kept short-lived, only ever handed to authenticated owner/share-checked
// callers, and never logged or persisted. See root CLAUDE.md privacy rules.
export const MEDIA_PRESIGN_TTL_SECONDS = 3600; // 1 hour

// Subset of the Prisma Media row needed to build a client DTO.
export type MediaRow = {
  id: string;
  linkedType: string;
  linkedId: string;
  mediaType: string;
  filename: string;
  fileSizeBytes: bigint;
  createdAt: Date;
  s3KeyDisplay: string;
  s3KeyThumbnail: string | null;
  color: string | null;
};

async function presignGet(
  key: string,
  opts?: { downloadFilename?: string },
): Promise<string> {
  return getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: MEDIA_BUCKET,
      Key: key,
      ...(opts?.downloadFilename && {
        ResponseContentDisposition: `attachment; filename="${opts.downloadFilename.replace(/"/g, "")}"`,
      }),
    }),
    { expiresIn: MEDIA_PRESIGN_TTL_SECONDS },
  );
}

// Maps a Media row to the client DTO, minting fresh presigned URLs. Track files
// (no thumbnail) force a download with their original filename; images/videos
// load inline.
export async function toMediaItem(row: MediaRow): Promise<MediaItem> {
  const category = mediaCategory(row.mediaType);
  const displayUrl = await presignGet(
    row.s3KeyDisplay,
    category === "track" ? { downloadFilename: row.filename } : undefined,
  );
  const thumbnailUrl = row.s3KeyThumbnail ? await presignGet(row.s3KeyThumbnail) : null;
  return {
    id: row.id,
    linkedType: row.linkedType as MediaLinkedType,
    linkedId: row.linkedId,
    mediaType: row.mediaType,
    filename: row.filename,
    fileSizeBytes: Number(row.fileSizeBytes),
    createdAt: row.createdAt.toISOString(),
    displayUrl,
    thumbnailUrl,
    color: row.color,
  };
}

export async function toMediaItems(rows: MediaRow[]): Promise<MediaItem[]> {
  return Promise.all(rows.map(toMediaItem));
}

// Presigns a batch of rows and groups the resulting DTOs by linkedId — used to
// attach per-trip media when reading a canyon or a list of trip logs.
export async function mediaItemsByLinkedId(
  rows: MediaRow[],
): Promise<Map<string, MediaItem[]>> {
  const items = await toMediaItems(rows);
  const grouped = new Map<string, MediaItem[]>();
  for (const item of items) {
    const list = grouped.get(item.linkedId) ?? [];
    list.push(item);
    grouped.set(item.linkedId, list);
  }
  return grouped;
}
