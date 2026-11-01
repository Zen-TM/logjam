// What a plan holds besides its write-up and forms: places, routes and files.
// Each is a copy that belongs to the plan (no owner, `planId` set),
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
import { Prisma, type Media } from "@prisma/client";
import {
  asFieldValues,
  asForeignFields,
  isSystemPlaceTypeId,
  say,
  SYSTEM_PLACE_TYPE_IDS,
  type TripPlanFile,
  type TripPlanItemAdd,
  type TripPlanItemKind,
  type TripPlanPlace,
  type TripPlanRoute,
  type TripPlanView,
} from "@logjam/shared";
import prisma from "../services/prisma";
import { AppError, fault } from "../middleware/errorHandler";
import { getEnv } from "./env";
import { requireStillMember, touchPlan } from "./planAccess";
import { dropMembership, endPlanForOthers } from "./planMembership";
import { reconcileCopiedPlace } from "./placeCopy";
import {
  copyMediaObjects,
  copyPlaceMedia,
  placeMediaToCopy,
  type PlaceMediaCopyResult,
} from "./copyPlaceMedia";
import { toMediaItem } from "./mediaPresign";
import {
  applyStorageChanges,
  assertHasStorageQuota,
  getStorageUsage,
  incrementStorageUsed,
  storageFull,
} from "./storageQuota";
import { deleteS3Keys, deleteS3KeysBestEffort } from "./s3Cleanup";

const MEDIA_BUCKET = getEnv().S3_BUCKET_MEDIA ?? "";

export const userRef = { select: { id: true, username: true } } as const;

export function itemNotFound(): AppError {
  return new AppError(404, say`Couldn't find that.`);
}

// ── Reading ────────────────────────────────────────────────────

type PlanItems = Pick<TripPlanView, "places" | "routes" | "files">;

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
  const [places, routes, files] = await Promise.all([
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
 * caller copied in S3 is removed again if the transaction fails. A plan's
 * adder must still be in it once the lock is held: a leave, a remove or an
 * account's hand-over can commit during the copy, and the file would then
 * be charged to someone the plan no longer has. Guard:
 * __tests__/planItems.test.ts ("charges no one who left during the copy").
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
      if ("planId" in owner) {
        await touchPlan(tx, owner.planId);
        await requireStillMember(tx, owner.planId, recipientId);
      }
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
  user: { id: string },
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
  }
}

async function addPlace(
  user: { id: string },
  planId: string,
  input: TripPlanItemAdd,
): Promise<AddedItem> {
  const place = await prisma.place.findFirst({
    where: { id: input.id, ownerId: user.id },
  });
  if (!place) throw itemNotFound();
  // The photos always come. Preflight, as POST /places/:id/copy: over quota is
  // a 507 with nothing made.
  const { rows: photos, totalBytes } = await placeMediaToCopy(place.id);
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
 * The storage changes a transaction collects, by user, applied once at its
 * end by applyStorageChanges (which orders the row locks).
 */
type Usage = Map<string, bigint>;

function change(usage: Usage, userId: string | null, bytes: bigint): void {
  if (userId) usage.set(userId, (usage.get(userId) ?? 0n) + bytes);
}

/** Count what the delete removed back to each payer. */
function refundInto(usage: Usage, rows: Refund[]): void {
  for (const row of rows) change(usage, row.charged_to_id, -(row.bytes ?? 0n));
}

/** Give each payer back what the delete removed. */
async function refund(
  tx: Prisma.TransactionClient,
  rows: Refund[],
): Promise<void> {
  const usage: Usage = new Map();
  refundInto(usage, rows);
  await applyStorageChanges(usage, tx);
}

function deleteMediaReturning(tx: Prisma.TransactionClient, where: Prisma.Sql) {
  return tx.$queryRaw<(Refund & MediaKeys)[]>`
    DELETE FROM media WHERE ${where}
    RETURNING charged_to_id, file_size_bytes AS bytes,
      s3_key_display AS "s3KeyDisplay", s3_key_thumbnail AS "s3KeyThumbnail"
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
    }
    if (count === 0) throw itemNotFound();
  });
}

/**
 * Which of a plan's files go: a WHERE over `media`. A place's photos carry its
 * adder, so `addedBy` takes them with the place.
 */
type PlanFiles = Prisma.Sql;
const planFiles = {
  all: (planId: string) => Prisma.sql`plan_id = ${planId}`,
  addedBy: (planId: string, userId: string) =>
    Prisma.sql`plan_id = ${planId} AND added_by_id = ${userId}`,
  chargedTo: (planId: string, userId: string) =>
    Prisma.sql`plan_id = ${planId} AND charged_to_id = ${userId}`,
};

/**
 * Before the transaction: delete the objects of the files `which` names. S3
 * goes first, so a failure leaves the rows and their keys for a retry.
 * Returns the keys it deleted.
 */
async function deletePlanFileObjects(which: PlanFiles): Promise<string[]> {
  const media = await prisma.$queryRaw<MediaKeys[]>`
    SELECT s3_key_display AS "s3KeyDisplay", s3_key_thumbnail AS "s3KeyThumbnail"
    FROM media WHERE ${which}
  `;
  const keys = mediaKeysOf(media);
  await deleteS3Keys(MEDIA_BUCKET, keys);
  return keys;
}

/**
 * In the plan's transaction, after touchPlan: delete the rows `which` names,
 * counting each payer's refund into `usage`. Returns what to run after
 * commit: it deletes the objects of the files whose keys are not in `gone`,
 * what deletePlanFileObjects deleted before.
 */
async function dropPlanFiles(
  tx: Prisma.TransactionClient,
  which: PlanFiles,
  gone: string[],
  usage: Usage,
): Promise<() => Promise<void>> {
  const files = await deleteMediaReturning(tx, which);
  refundInto(usage, files);
  const done = new Set(gone);
  const lateKeys = mediaKeysOf(files).filter((key) => !done.has(key));
  return () => deleteS3KeysBestEffort(MEDIA_BUCKET, lateKeys);
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
  const which = planFiles.all(planId);
  const gone = await deletePlanFileObjects(which);
  const { late, result } = await prisma.$transaction(async (tx) => {
    await touchPlan(tx, planId);
    const usage: Usage = new Map();
    const late = await dropPlanFiles(tx, which, gone, usage);
    await applyStorageChanges(usage, tx);
    const result = await beforeDelete(tx);
    await tx.tripPlan.delete({ where: { id: planId } });
    return { late, result };
  });
  await late();
  return result;
}

// ── Someone going ──────────────────────────────────────────────

/**
 * Move the plan's files charged to `fromId` onto `toId`, counting the usage
 * into `usage`. Never refused for quota: a leader removing someone takes on
 * their files, or deletes them instead. Guard: __tests__/planItems.test.ts
 * ("takes on the files past the leader's quota").
 */
async function moveCharges(
  tx: Prisma.TransactionClient,
  planId: string,
  fromId: string,
  toId: string,
  usage: Usage,
): Promise<void> {
  const moved = await tx.$queryRaw<{ bytes: bigint | null }[]>`
    UPDATE media SET charged_to_id = ${toId}
    WHERE plan_id = ${planId} AND charged_to_id = ${fromId}
    RETURNING file_size_bytes AS bytes
  `;
  const bytes = moved.reduce((sum, row) => sum + (row.bytes ?? 0n), 0n);
  change(usage, fromId, -bytes);
  change(usage, toId, bytes);
}

/**
 * An active member leaving or removed (DELETE /plans/:planId/members/:userId).
 * Leave keeps what they added and what it counts against; `deleteAdded`
 * deletes everything they added. Remove is as leave, but the files charged
 * to them move to the leader removing them, or go with `deleteFiles`.
 */
export type MemberGoing = {
  planId: string;
  memberId: string;
  removedBy: string | null;
  deleteAdded: boolean;
  deleteFiles: boolean;
};

function goingFiles(going: MemberGoing): PlanFiles | null {
  if (going.deleteAdded) return planFiles.addedBy(going.planId, going.memberId);
  if (going.removedBy && going.deleteFiles)
    return planFiles.chargedTo(going.planId, going.memberId);
  return null;
}

/**
 * In the members route's transaction, after touchPlan and its re-read, for a
 * member who was active. Returns what to run after commit: it deletes the
 * objects of the files that went. After, not before as everywhere else here:
 * the route's 409s run inside the transaction, and an S3 pass they abort
 * would leave rows whose files are gone.
 * A failed S3 delete orphans the object, which the media sweeper
 * (lib/mediaOrphanSweeper.ts) takes.
 * Guard: __tests__/planItems.test.ts ("storage when someone goes").
 */
export async function memberGone(
  tx: Prisma.TransactionClient,
  going: MemberGoing,
): Promise<() => Promise<void>> {
  const { planId, memberId, removedBy } = going;
  const usage: Usage = new Map();
  const which = goingFiles(going);
  const late = which
    ? await dropPlanFiles(tx, which, [], usage)
    : async () => {};
  if (going.deleteAdded) {
    await tx.route.deleteMany({ where: { planId, addedById: memberId } });
    await tx.place.deleteMany({ where: { planId, addedById: memberId } });
  }
  if (removedBy) await moveCharges(tx, planId, memberId, removedBy, usage);
  await applyStorageChanges(usage, tx);
  return late;
}

/**
 * Account delete, before the account's own transaction. Each plan the user is
 * active in or pays for, one transaction per plan after touchPlan, so no
 * transaction here holds two plan rows and every decision is made under the
 * plan's lock:
 * - with no one else active, the plan is deleted, files and all, and anyone
 *   invited or asking is told; its objects go after commit, as in
 *   memberGone;
 * - otherwise, with no other leader, the earliest member (by row) becomes
 *   one; the files charged to the user move to the plan's creator while they
 *   are in it, else to the earliest leader; and the user is out of the plan,
 *   as a leave, so a second departure or another of their devices sees them
 *   gone. That holds even if the account delete fails later.
 * Guard: __tests__/planItems.test.ts ("storage when someone goes").
 */
export async function handOverPlans(userId: string): Promise<void> {
  const plans = await prisma.tripPlan.findMany({
    where: {
      OR: [
        { members: { some: { userId, status: "active" } } },
        { media: { some: { chargedToId: userId } } },
      ],
    },
    select: { id: true, createdById: true },
  });
  for (const plan of plans) {
    try {
      const { late, push } = await prisma.$transaction(async (tx) => {
        await touchPlan(tx, plan.id);
        const usage: Usage = new Map();
        const others = await tx.tripPlanMember.findMany({
          where: { planId: plan.id, status: "active", userId: { not: userId } },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { id: true, userId: true, role: true },
        });
        if (others.length === 0) {
          const late = await dropPlanFiles(
            tx,
            planFiles.all(plan.id),
            [],
            usage,
          );
          await applyStorageChanges(usage, tx);
          const push = await endPlanForOthers(tx, plan.id, userId);
          await tx.tripPlan.delete({ where: { id: plan.id } });
          return { late, push };
        }
        let leader = others.find((member) => member.role === "leader");
        if (!leader) {
          leader = others[0];
          await tx.tripPlanMember.update({
            where: { id: leader.id },
            data: { role: "leader" },
          });
        }
        const heir = others.some((member) => member.userId === plan.createdById)
          ? plan.createdById!
          : leader.userId;
        await moveCharges(tx, plan.id, userId, heir, usage);
        await applyStorageChanges(usage, tx);
        await dropMembership(tx, plan.id, userId);
        return { late: async () => {}, push: () => {} };
      });
      push();
      await late();
    } catch (err) {
      // Deleted by someone else meanwhile: nothing of theirs to hand over.
      if (!(err instanceof AppError && err.statusCode === 404)) throw err;
    }
  }
}
