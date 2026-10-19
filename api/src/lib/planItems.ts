// What a plan holds besides its write-up and forms: places, routes, files and
// GeoPDFs. Each is a copy that belongs to the plan (no owner, `planId` set),
// made by Add a copy from something the adder owns, and copied back out by
// Save a copy. One copy path per kind: a place goes through the place copy's
// pieces (lib/placeCopy.ts, copyPlaceMedia.ts), a file through the same
// server-side object copy.
//
// STORAGE. A file in a plan counts against `chargedToId`, the adder when it
// arrives; deleting it refunds whoever that is by then. Every refund reads the
// bytes the delete itself removed (DELETE … RETURNING), so two deletes racing
// never refund twice (the bulkDelete.ts pattern).
//
// LINKS. A plan route links only to a place of the same plan, and a plan
// file to nothing: a place's route arrives linked to the plan's copy of the
// place, and nothing else here sets a link. A plan row linked to an owned
// place would reach that place's sharees (`hasPlaceInheritedAccess`, the
// place-linked media arm of /sync/delta).
// Guard: __tests__/planItems.test.ts.
import { CopyObjectCommand } from "@aws-sdk/client-s3";
import { Prisma, type GeoPdfJob, type Media } from "@prisma/client";
import {
  asFieldValues,
  asForeignFields,
  isSystemPlaceTypeId,
  normalizeUserUiPreferences,
  say,
  SYSTEM_PLACE_TYPE_IDS,
  type TripPlanFile,
  type TripPlanGeoPdf,
  type TripPlanItemAdd,
  type TripPlanItemKind,
  type TripPlanPlace,
  type TripPlanRoute,
  type TripPlanView,
} from "@logjam/shared";
import { randomUUID } from "crypto";
import prisma from "../services/prisma";
import { s3 } from "../services/awsClients";
import { AppError, fault } from "../middleware/errorHandler";
import { getEnv } from "./env";
import { logger, safeErrorForLog } from "./logger";
import { touchPlan } from "./planAccess";
import { reconcileCopiedPlace } from "./placeCopy";
import {
  copyMediaObjects,
  copyPlaceMedia,
  placeMediaToCopy,
  type PlaceMediaCopyResult,
} from "./copyPlaceMedia";
import { toMediaItem } from "./mediaPresign";
import {
  assertHasStorageQuota,
  decrementStorageUsed,
  getStorageUsage,
  incrementStorageUsed,
  storageFull,
} from "./storageQuota";
import { deleteS3Keys, deleteS3KeysBestEffort } from "./s3Cleanup";
import { geoPdfTitle } from "./geoPdfTitle";
import {
  geoPdfDownloadFilename,
  presignResult,
  planResultKeyFor,
  resultKeyFor,
  TOPO_BUCKET,
} from "./geoPdfResult";

const MEDIA_BUCKET = getEnv().S3_BUCKET_MEDIA ?? "";

export const userRef = { select: { id: true, username: true } } as const;

export function itemNotFound(): AppError {
  return new AppError(404, say`Couldn't find that.`);
}

// ── Reading ────────────────────────────────────────────────────

type PlanItems = Pick<TripPlanView, "places" | "routes" | "files" | "geoPdfs">;

function itemBase(row: {
  id: string;
  addedBy: { id: string; username: string } | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    addedBy: row.addedBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function charge(row: {
  bytes: bigint | null;
  chargedTo: { id: string; username: string } | null;
}) {
  return { sizeBytes: (row.bytes ?? 0n).toString(), chargedTo: row.chargedTo };
}

/**
 * The plan's items as GET /plans/:id serves them, files presigned as
 * GET /places/:id does. `only` narrows it to one item (an add's response).
 */
export async function loadPlanItems(
  planId: string,
  only?: { kind: TripPlanItemKind; id: string },
): Promise<PlanItems> {
  const want = (kind: TripPlanItemKind) => !only || only.kind === kind;
  const where = only ? { planId, id: only.id } : { planId };
  const order = [{ createdAt: "asc" }, { id: "asc" }] as const;
  const fileInclude = { addedBy: userRef, chargedTo: userRef } as const;
  const [places, routes, files, geoPdfs] = await Promise.all([
    want("place")
      ? prisma.place.findMany({
          where,
          include: { addedBy: userRef },
          orderBy: [...order],
        })
      : [],
    want("route")
      ? prisma.route.findMany({
          where,
          include: { addedBy: userRef },
          orderBy: [...order],
        })
      : [],
    want("media")
      ? prisma.media.findMany({
          where: { ...where, linkedType: "none" },
          include: fileInclude,
          orderBy: [...order],
        })
      : [],
    want("geoPdf")
      ? prisma.geoPdfJob.findMany({
          where,
          include: fileInclude,
          orderBy: [...order],
        })
      : [],
  ]);
  const photos = places.length
    ? await prisma.media.findMany({
        where: {
          planId,
          linkedType: "place",
          linkedId: { in: places.map((p) => p.id) },
        },
        include: { chargedTo: userRef },
        orderBy: [...order],
      })
    : [];

  return {
    places: await Promise.all(
      places.map(
        async (row): Promise<TripPlanPlace> => ({
          kind: "place",
          ...itemBase(row),
          name: row.name,
          altNames: row.altNames,
          latitude: row.latitude,
          longitude: row.longitude,
          elevation: row.elevation,
          placeTypeId: row.placeTypeId,
          notes: row.notes,
          fieldValues: asFieldValues(row.fieldValues),
          foreignFields: row.foreignFields
            ? asForeignFields(row.foreignFields)
            : null,
          ropeWikiId: row.ropeWikiId,
          media: await Promise.all(
            photos
              .filter((photo) => photo.linkedId === row.id)
              .map(async (photo) => ({
                ...(await toMediaItem(photo)),
                ...charge({
                  bytes: photo.fileSizeBytes,
                  chargedTo: photo.chargedTo,
                }),
              })),
          ),
        }),
      ),
    ),
    routes: routes.map(
      (row): TripPlanRoute => ({
        kind: "route",
        ...itemBase(row),
        placeId: row.placeId,
        name: row.name,
        color: row.color,
        points: row.points as [number, number][],
        anchors: (row.anchors as number[] | null) ?? null,
      }),
    ),
    files: await Promise.all(
      files.map(
        async (row): Promise<TripPlanFile> => ({
          kind: "media",
          ...itemBase(row),
          ...charge({ bytes: row.fileSizeBytes, chargedTo: row.chargedTo }),
          item: await toMediaItem(row),
        }),
      ),
    ),
    geoPdfs: await Promise.all(
      geoPdfs.map(async (row): Promise<TripPlanGeoPdf> => {
        const download = await presignResult(
          row.resultKey,
          geoPdfDownloadFilename(row.config, row.createdAt),
        );
        return {
          kind: "geoPdf",
          ...itemBase({ ...row, updatedAt: row.completedAt ?? row.createdAt }),
          ...charge({ bytes: row.resultBytes, chargedTo: row.chargedTo }),
          title: geoPdfTitle(row.config),
          downloadUrl: download?.url ?? null,
          downloadExpiresAt: download?.expiresAt ?? null,
        };
      }),
    ),
  };
}

// ── Copying files ──────────────────────────────────────────────

/** Who a copied file belongs to: a plan (charged to the adder) or a user. */
type FileOwner = { planId: string } | { ownerId: string };

function ownerColumns(owner: FileOwner, recipientId: string) {
  return "planId" in owner
    ? { planId: owner.planId, addedById: recipientId, chargedToId: recipientId }
    : { ownerId: recipientId };
}

/**
 * Charge `recipientId` for `bytes` and write the row, in one transaction
 * whose first statement touches the plan (if it is one). The authoritative
 * quota check runs after the charge, under the user row's lock; whatever the
 * caller copied in S3 is removed again if the transaction fails.
 */
async function chargeAndWrite<T>(
  owner: FileOwner,
  recipientId: string,
  bytes: bigint,
  keys: { bucket: string; keys: string[] },
  write: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  try {
    return await prisma.$transaction(async (tx) => {
      if ("planId" in owner) await touchPlan(tx, owner.planId);
      await incrementStorageUsed(recipientId, bytes, tx);
      const { used, quota } = await getStorageUsage(recipientId, tx);
      if (used > quota) throw storageFull(used - bytes, quota);
      return write(tx);
    });
  } catch (err) {
    await deleteS3KeysBestEffort(keys.bucket, keys.keys);
    throw err;
  }
}

/** A standalone file (an import or a track) copied for `owner`, unlinked. */
export async function copyStandaloneFile(
  source: Media,
  recipientId: string,
  owner: FileOwner,
): Promise<Media> {
  await assertHasStorageQuota(recipientId, source.fileSizeBytes);
  const copy = await copyMediaObjects(source, recipientId);
  if (!copy) throw fault("a file's objects could not be copied", 502);
  return chargeAndWrite(
    owner,
    recipientId,
    source.fileSizeBytes,
    { bucket: MEDIA_BUCKET, keys: copy.keys },
    (tx) =>
      tx.media.create({
        data: {
          id: copy.mediaId,
          ...ownerColumns(owner, recipientId),
          linkedType: "none",
          linkedId: null,
          s3KeyDisplay: copy.displayKey,
          s3KeyThumbnail: copy.thumbnailKey,
          mediaType: source.mediaType,
          filename: source.filename,
          fileSizeBytes: source.fileSizeBytes,
          color: source.color,
          origin: source.origin,
          displayName: source.displayName,
          metadata: source.metadata as Prisma.InputJsonValue,
        },
      }),
  );
}

/** A completed GeoPDF copied for `owner`, with its own object. */
export async function copyGeoPdf(
  source: GeoPdfJob,
  recipientId: string,
  owner: FileOwner,
): Promise<GeoPdfJob> {
  if (!source.resultKey) throw fault("a completed GeoPDF has no result key");
  const bytes = source.resultBytes ?? 0n;
  await assertHasStorageQuota(recipientId, bytes);
  const id = randomUUID();
  const key = "planId" in owner ? planResultKeyFor(id) : resultKeyFor(id);
  try {
    await s3.send(
      new CopyObjectCommand({
        Bucket: TOPO_BUCKET,
        CopySource: `${TOPO_BUCKET}/${source.resultKey}`,
        Key: key,
      }),
    );
  } catch (err) {
    logger.warn(
      { jobId: source.id, err: safeErrorForLog(err) },
      "plan_geo_pdf_copy_failed",
    );
    await deleteS3KeysBestEffort(TOPO_BUCKET, [key]);
    throw fault("a GeoPDF's object could not be copied", 502);
  }
  return chargeAndWrite(
    owner,
    recipientId,
    bytes,
    { bucket: TOPO_BUCKET, keys: [key] },
    (tx) =>
      tx.geoPdfJob.create({
        data: {
          id,
          ...("planId" in owner
            ? ownerColumns(owner, recipientId)
            : { userId: recipientId }),
          config: source.config as Prisma.InputJsonValue,
          vectorStyleSnapshot:
            source.vectorStyleSnapshot as Prisma.InputJsonValue,
          estimatedSeconds: source.estimatedSeconds,
          status: "completed",
          resultKey: key,
          resultBytes: source.resultBytes,
          completedAt: new Date(),
        },
      }),
  );
}

// ── Add a copy ─────────────────────────────────────────────────

export type AddedItem = {
  id: string;
  media?: PlaceMediaCopyResult;
};

/**
 * Add a copy of one of the caller's own things to the plan, charged to them.
 * Anything they don't own (a place shared with them, another plan's row, a
 * missing id) is the same 404.
 */
export async function addPlanItem(
  user: { id: string; uiPreferences: Prisma.JsonValue },
  planId: string,
  input: TripPlanItemAdd,
): Promise<AddedItem> {
  switch (input.kind) {
    case "place":
      return addPlace(user, planId, input);
    case "route": {
      const source = await prisma.route.findFirst({
        where: { id: input.id, ownerId: user.id },
      });
      if (!source) throw itemNotFound();
      const row = await prisma.$transaction(async (tx) => {
        await touchPlan(tx, planId);
        // Unlinked: its place, if any, is the owner's, not the plan's.
        return tx.route.create({
          data: {
            planId,
            addedById: user.id,
            name: source.name,
            color: source.color,
            points: source.points as Prisma.InputJsonValue,
            anchors: source.anchors ?? Prisma.DbNull,
          },
        });
      });
      return { id: row.id };
    }
    case "media": {
      const source = await prisma.media.findFirst({
        where: { id: input.id, ownerId: user.id, origin: { not: null } },
      });
      if (!source) throw itemNotFound();
      const row = await copyStandaloneFile(source, user.id, { planId });
      return { id: row.id };
    }
    case "geoPdf": {
      const source = await prisma.geoPdfJob.findFirst({
        where: { id: input.id, userId: user.id, status: { not: "failed" } },
      });
      if (!source) throw itemNotFound();
      if (source.status !== "completed")
        throw new AppError(
          409,
          say`A GeoPDF that is still being made can't be added.`,
        );
      const row = await copyGeoPdf(source, user.id, { planId });
      return { id: row.id };
    }
  }
}

async function addPlace(
  user: { id: string; uiPreferences: Prisma.JsonValue },
  planId: string,
  input: TripPlanItemAdd,
): Promise<AddedItem> {
  const place = await prisma.place.findFirst({
    where: { id: input.id, ownerId: user.id },
  });
  if (!place) throw itemNotFound();
  const copyMedia =
    input.copyMedia ??
    normalizeUserUiPreferences(user.uiPreferences).copyPlaceMedia;
  // Preflight, as POST /places/:id/copy: over quota is a 507 with nothing made.
  const { rows: photos, totalBytes } = copyMedia
    ? await placeMediaToCopy(place.id)
    : { rows: [], totalBytes: 0n };
  if (totalBytes > 0n) await assertHasStorageQuota(user.id, totalBytes);

  // A plan holds system types only: a user's own type would make that user's
  // account delete fail (Place.placeTypeId restricts). Anything else lands as
  // a Marker, its values parked with their labels (ADR 0018). Guard:
  // __tests__/planItems.test.ts ("lands a place of the adder's own type as a Marker").
  const placeTypeId = isSystemPlaceTypeId(place.placeTypeId)
    ? place.placeTypeId
    : SYSTEM_PLACE_TYPE_IDS.marker;
  const reconciled = await reconcileCopiedPlace({
    recipientId: null,
    sourceOwnerId: user.id,
    sourceTypeId: place.placeTypeId,
    targetTypeId: placeTypeId,
    fieldValues: place.fieldValues,
  });
  const route = await prisma.route.findUnique({ where: { placeId: place.id } });

  const planPlace = await prisma.$transaction(async (tx) => {
    await touchPlan(tx, planId);
    const row = await tx.place.create({
      data: {
        planId,
        addedById: user.id,
        name: place.name,
        altNames: place.altNames,
        latitude: place.latitude,
        longitude: place.longitude,
        elevation: place.elevation,
        placeTypeId,
        notes: place.notes,
        fieldValues: reconciled.fieldValues as Prisma.InputJsonValue,
        foreignFields:
          reconciled.foreignFields.length > 0
            ? (reconciled.foreignFields as unknown as Prisma.InputJsonValue)
            : Prisma.DbNull,
        // No owner, so no `@@unique([ownerId, ropeWikiId])` clash. Lineage
        // stays out: a member must not learn the adder's row id.
        ropeWikiId: place.ropeWikiId,
      },
    });
    if (route)
      await tx.route.create({
        data: {
          planId,
          addedById: user.id,
          placeId: row.id,
          name: route.name,
          color: route.color,
          points: route.points as Prisma.InputJsonValue,
          anchors: route.anchors ?? Prisma.DbNull,
        },
      });
    return row;
  });

  const media = photos.length
    ? await copyPlaceMedia({
        sourcePlaceId: place.id,
        targetPlaceId: planPlace.id,
        recipientId: user.id,
        planId,
      })
    : { copied: 0, skipped: 0 };
  return { id: planPlace.id, media };
}

// ── Deleting ───────────────────────────────────────────────────

type Refund = { charged_to_id: string | null; bytes: bigint | null };

/**
 * Give each payer back what the delete removed, in user id order: two
 * deletes locking the same payers in opposite orders would deadlock.
 */
async function refund(
  tx: Prisma.TransactionClient,
  rows: Refund[],
): Promise<void> {
  const byPayer = new Map<string, bigint>();
  for (const row of rows)
    if (row.charged_to_id)
      byPayer.set(
        row.charged_to_id,
        (byPayer.get(row.charged_to_id) ?? 0n) + (row.bytes ?? 0n),
      );
  for (const [userId, bytes] of [...byPayer].sort(([a], [b]) =>
    a < b ? -1 : 1,
  ))
    await decrementStorageUsed(userId, bytes, tx);
}

function deleteMediaReturning(tx: Prisma.TransactionClient, where: Prisma.Sql) {
  return tx.$queryRaw<(Refund & MediaKeys)[]>`
    DELETE FROM media WHERE ${where}
    RETURNING charged_to_id, file_size_bytes AS bytes,
      s3_key_display AS "s3KeyDisplay", s3_key_thumbnail AS "s3KeyThumbnail"
  `;
}

function deleteGeoPdfsReturning(
  tx: Prisma.TransactionClient,
  where: Prisma.Sql,
) {
  return tx.$queryRaw<(Refund & { id: string })[]>`
    DELETE FROM geo_pdf_jobs WHERE ${where}
    RETURNING id, charged_to_id, result_bytes AS bytes
  `;
}

type MediaKeys = { s3KeyDisplay: string; s3KeyThumbnail: string | null };
const mediaKeySelect = { s3KeyDisplay: true, s3KeyThumbnail: true } as const;

const mediaKeysOf = (rows: MediaKeys[]) =>
  rows.flatMap((row) =>
    row.s3KeyThumbnail
      ? [row.s3KeyDisplay, row.s3KeyThumbnail]
      : [row.s3KeyDisplay],
  );

/**
 * Delete one item of the plan: S3 objects first (a failure leaves the row and
 * its keys for a retry), then, in one transaction that touches the plan, the
 * rows and the refund. A place takes its photos with it; its route stays, as
 * an owned place's does.
 */
export async function deletePlanItem(
  planId: string,
  kind: TripPlanItemKind,
  id: string,
): Promise<void> {
  if (kind === "media" || kind === "place") {
    const files = await prisma.media.findMany({
      where:
        kind === "media"
          ? { planId, id, linkedType: "none" }
          : { planId, linkedType: "place", linkedId: id },
      select: mediaKeySelect,
    });
    await deleteS3Keys(MEDIA_BUCKET, mediaKeysOf(files));
  }
  if (kind === "geoPdf")
    await deleteS3Keys(TOPO_BUCKET, [planResultKeyFor(id)]);

  await prisma.$transaction(async (tx) => {
    await touchPlan(tx, planId);
    let count: number;
    switch (kind) {
      case "place": {
        await refund(
          tx,
          await deleteMediaReturning(
            tx,
            Prisma.sql`plan_id = ${planId} AND linked_type = 'place' AND linked_id = ${id}`,
          ),
        );
        ({ count } = await tx.place.deleteMany({ where: { id, planId } }));
        break;
      }
      case "route":
        ({ count } = await tx.route.deleteMany({ where: { id, planId } }));
        break;
      case "media": {
        const rows = await deleteMediaReturning(
          tx,
          Prisma.sql`plan_id = ${planId} AND id = ${id} AND linked_type = 'none'`,
        );
        await refund(tx, rows);
        count = rows.length;
        break;
      }
      case "geoPdf": {
        const rows = await deleteGeoPdfsReturning(
          tx,
          Prisma.sql`plan_id = ${planId} AND id = ${id}`,
        );
        await refund(tx, rows);
        count = rows.length;
        break;
      }
    }
    if (count === 0) throw itemNotFound();
  });
}

/**
 * Delete a whole plan with its files: S3 first, then in one transaction the
 * file rows (refunding each payer) and the plan, whose cascade takes the
 * rest. The plan row is taken first, so an Add a copy either committed
 * before (its row is deleted and refunded here) or finds the plan gone.
 * A file added between the S3 pass and the lock is removed after commit.
 * `beforeDelete` runs in the transaction just before the plan row goes.
 * Guard: __tests__/planItems.test.ts ("deleting the plan refunds").
 */
export async function deletePlanWithFiles<T>(
  planId: string,
  beforeDelete: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const [media, jobs] = await Promise.all([
    prisma.media.findMany({
      where: { planId },
      select: mediaKeySelect,
    }),
    prisma.geoPdfJob.findMany({ where: { planId }, select: { id: true } }),
  ]);
  const knownKeys = mediaKeysOf(media);
  const knownJobs = new Set(jobs.map((j) => j.id));
  await Promise.all([
    deleteS3Keys(MEDIA_BUCKET, knownKeys),
    deleteS3Keys(TOPO_BUCKET, [...knownJobs].map(planResultKeyFor)),
  ]);

  const late = await prisma.$transaction(async (tx) => {
    await touchPlan(tx, planId);
    const files = await deleteMediaReturning(
      tx,
      Prisma.sql`plan_id = ${planId}`,
    );
    const pdfs = await deleteGeoPdfsReturning(
      tx,
      Prisma.sql`plan_id = ${planId}`,
    );
    await refund(tx, [...files, ...pdfs]);
    const result = await beforeDelete(tx);
    await tx.tripPlan.delete({ where: { id: planId } });
    const known = new Set(knownKeys);
    return {
      result,
      keys: mediaKeysOf(files).filter((key) => !known.has(key)),
      jobs: pdfs.filter((pdf) => !knownJobs.has(pdf.id)).map((pdf) => pdf.id),
    };
  });
  await deleteS3KeysBestEffort(MEDIA_BUCKET, late.keys);
  await deleteS3KeysBestEffort(TOPO_BUCKET, late.jobs.map(planResultKeyFor));
  return late.result;
}
