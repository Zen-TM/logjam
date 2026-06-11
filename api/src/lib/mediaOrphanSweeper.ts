import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import prisma from "../services/prisma";
import { s3 } from "../services/awsClients";
import { deleteS3Keys } from "./s3Cleanup";
import { getEnv } from "./env";
import { logger } from "./logger";

/**
 * Orphaned-upload sweep (SEC-003 cleanup half).
 *
 * A presigned PUT can succeed without /media/:id/confirm ever being called:
 * no Media row exists, no quota is charged, and the object would sit in the
 * media bucket forever (the bucket has no lifecycle rules — verified
 * 2026-06-11). The sweep lists `media/` objects, keeps anything whose
 * mediaId has a confirmed Media row or shows activity newer than
 * MEDIA_ORPHAN_TTL_MS, and deletes the rest. The DB-row check makes deleting
 * confirmed media impossible by construction, which is why this is a sweep
 * and not an S3 lifecycle rule (a tag-based rule could expire confirmed
 * objects if confirm's tag removal ever failed).
 */

export interface MediaObjectListing {
  key: string;
  lastModified: Date;
}

// Keys are minted exclusively by mediaKeys() in routes/media.ts as
// media/<ownerId>/<mediaId>/<basename>. Anything else under the prefix is not
// ours to delete — parse failures are skipped, never swept.
const MEDIA_KEY_PATTERN = /^media\/[^/]+\/([^/]+)\/[^/]+$/;

export function mediaIdFromKey(key: string): string | null {
  const match = MEDIA_KEY_PATTERN.exec(key);
  return match ? match[1] : null;
}

/**
 * Pure selection: returns the S3 keys safe to delete. A mediaId's objects are
 * orphans only when the id has no confirmed row AND every object in the group
 * is older than the cutoff — one recent object marks the whole group as
 * possibly mid-upload and defers it to a later sweep.
 */
export function selectOrphanedUploadKeys(
  objects: MediaObjectListing[],
  confirmedMediaIds: ReadonlySet<string>,
  cutoff: Date,
): string[] {
  const groups = new Map<string, { keys: string[]; hasRecent: boolean }>();
  for (const obj of objects) {
    const mediaId = mediaIdFromKey(obj.key);
    if (!mediaId) continue;
    const group = groups.get(mediaId) ?? { keys: [], hasRecent: false };
    group.keys.push(obj.key);
    if (obj.lastModified >= cutoff) group.hasRecent = true;
    groups.set(mediaId, group);
  }

  const orphanKeys: string[] = [];
  for (const [mediaId, group] of groups) {
    if (group.hasRecent || confirmedMediaIds.has(mediaId)) continue;
    orphanKeys.push(...group.keys);
  }
  return orphanKeys;
}

/**
 * List `media/` objects, diff against confirmed Media rows, delete orphans.
 * Returns the number of objects deleted. Failures propagate to the caller's
 * catch (the objects survive to the next sweep).
 */
export async function sweepOrphanedMediaUploads(
  now: Date = new Date(),
): Promise<number> {
  const env = getEnv();
  if (env.MEDIA_ORPHAN_TTL_MS === 0) return 0;
  const bucket = env.S3_BUCKET_MEDIA;
  if (!bucket) return 0;

  const cutoff = new Date(now.getTime() - env.MEDIA_ORPHAN_TTL_MS);

  const objects: MediaObjectListing[] = [];
  let continuationToken: string | undefined;
  do {
    const listed = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: "media/",
        ContinuationToken: continuationToken,
      }),
    );
    for (const obj of listed.Contents ?? []) {
      if (obj.Key && obj.LastModified) {
        objects.push({ key: obj.Key, lastModified: obj.LastModified });
      }
    }
    continuationToken = listed.IsTruncated
      ? listed.NextContinuationToken
      : undefined;
  } while (continuationToken);

  if (objects.length === 0) return 0;

  const candidateIds = [
    ...new Set(
      objects
        .map((obj) => mediaIdFromKey(obj.key))
        .filter((id): id is string => id !== null),
    ),
  ];
  const confirmedRows = await prisma.media.findMany({
    where: { id: { in: candidateIds } },
    select: { id: true },
  });
  const confirmedIds = new Set(confirmedRows.map((row) => row.id));

  const orphanKeys = selectOrphanedUploadKeys(objects, confirmedIds, cutoff);
  if (orphanKeys.length === 0) return 0;

  await deleteS3Keys(bucket, orphanKeys);
  logger.info(
    { deleted: orphanKeys.length, scanned: objects.length },
    "orphaned_media_uploads_swept",
  );
  return orphanKeys.length;
}
