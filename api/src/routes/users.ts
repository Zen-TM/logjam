import { Router, Response } from "express";
import { createHash } from "crypto";
import { Prisma, User } from "@prisma/client";
import { z } from "zod";
import {
  say,
  normalizeThemeSchemeId,
  normalizeUserUiPreferences,
  MAX_SLOPE_BANDS,
  parseSlopeBands,
  normalizeImportMergePolicy,
  isNotificationPreferences,
  USERNAME_MAX,
  USERNAME_MIN,
  USERNAME_PATTERN,
  USERNAME_RULE,
  USERNAME_TAKEN,
} from "@logjam/shared";
import { defsForUserResponse } from "../lib/customFieldDefs";
import { EXPORT_SCHEMA_VERSION, loadExportSections } from "../lib/dataExport";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { placeIdOfMedia } from "../lib/mediaLink";
import { AppError, malformed } from "../middleware/errorHandler";
import { resolveUser } from "../lib/resolveUser";
import {
  userPatchLimiter,
  usernameCheckLimiter,
} from "../middleware/rateLimit";
import { identityProvider } from "../lib/identityProvider";
import { getMonthlyCreditUsage } from "../lib/computeCredits";
import { getEgressUsage } from "../lib/egressQuota";
import { CURRENT_CONSENT_VERSION } from "../constants/consent";
import { getEnv } from "../lib/env";
import { deleteS3Keys, deleteS3Prefix } from "../lib/s3Cleanup";
import { deleteTopoJobObjects } from "../lib/topoUpload";
import { logger, safeErrorForLog } from "../lib/logger";
import { accountDeleteTombstones } from "../lib/syncTombstones";

const MEDIA_BUCKET = getEnv().S3_BUCKET_MEDIA ?? "";
const TOPO_BUCKET = getEnv().S3_BUCKET_TOPO ?? "";

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

// Create the first-login User row for a sub that has no row yet AND whose email
// is not already owned (the caller resolves the email-owned/rebind case first).
// Tolerates two collisions without depending on which unique Postgres reports:
//   - username already taken by a DIFFERENT user → retry with progressively
//     more-unique suffixes derived from the sub;
//   - a concurrent first-login request for THIS same sub winning the race →
//     recover the row it created (matched on cognitoId).
// An email that becomes owned between the caller's pre-check and the insert is a
// genuine concurrent conflict → AppError(409). Persistent collisions propagate
// rather than looping.
export async function createUserForSignup(params: {
  sub: string;
  email: string;
  initialUsername: string;
}): Promise<User> {
  const { sub, email, initialUsername } = params;
  // Which unique index a P2002 names, as a substring: the indexes are named
  // for their columns (`users_username_key`, `users_email_key`), and a
  // case-variant username trips `users_username_as_read_key` — still
  // "username". Under the pg driver adapter Prisma leaves `meta.target`
  // undefined and reports the index under `driverAdapterError`; `target` is
  // kept for an engine that fills it.
  const indexHas = (e: Prisma.PrismaClientKnownRequestError, name: string) => {
    const meta = e.meta as
      | {
          target?: unknown;
          driverAdapterError?: {
            cause?: { constraint?: { index?: unknown } };
          };
        }
      | undefined;
    const target = Array.isArray(meta?.target) ? meta.target.join(" ") : "";
    const index = meta?.driverAdapterError?.cause?.constraint?.index;
    return (
      target.includes(name) ||
      (typeof index === "string" && index.includes(name))
    );
  };
  const recoverRacingRow = async (): Promise<User | null> =>
    prisma.user.findUnique({ where: { cognitoId: sub } });

  const candidateUsernames = [
    initialUsername,
    `${initialUsername}-${sub.slice(0, 6)}`,
    `${initialUsername}-${sub.slice(0, 12)}`,
  ];

  for (let attempt = 0; attempt < candidateUsernames.length; attempt++) {
    try {
      return await prisma.user.create({
        data: {
          cognitoId: sub,
          subject: sub,
          email,
          username: candidateUsernames[attempt],
        },
      });
    } catch (e) {
      if (
        !(e instanceof Prisma.PrismaClientKnownRequestError) ||
        e.code !== "P2002"
      ) {
        throw e;
      }

      if (indexHas(e, "email")) {
        // Email got owned between the pre-check and now. If a concurrent
        // request for this same sub created it, use that row; otherwise a
        // genuinely different account owns the email.
        const racing = await recoverRacingRow();
        if (racing) return racing;
        throw new AppError(
          409,
          say`An account already exists for this email address. Contact support if you think that's a mistake.`,
        );
      }

      if (indexHas(e, "username")) {
        // Taken by a different user — try the next, more-unique suffix.
        if (attempt < candidateUsernames.length - 1) continue;
        // Exhausted suffixes (astronomically unlikely): recover a racing row or
        // surface loudly rather than spin.
        const racing = await recoverRacingRow();
        if (racing) return racing;
        throw e;
      }

      // Otherwise the cognitoId unique tripped: a concurrent first-login for
      // this sub won the race. Use its row.
      const racing = await recoverRacingRow();
      if (racing) return racing;
      throw e;
    }
  }

  // Unreachable: each loop iteration returns or throws.
  throw new AppError(500, say`Couldn't set up your account. Try again.`);
}

const usernameSchema = z
  .string()
  .trim()
  .min(USERNAME_MIN)
  .max(USERNAME_MAX)
  .regex(USERNAME_PATTERN);

/**
 * The name a new account starts with, which other users then see and search.
 * The token's own username counts only if it is a valid name that doesn't
 * contain the email's local part. usernameSchema already refuses an email or a
 * UUID, which is what arrives from a Managed Login sign-up, which has no
 * username field. Otherwise a neutral name from the sub: never anything derived
 * from the email.
 * Guard: users.unit.test.ts.
 */
export function initialUsernameFor(params: {
  sub: string;
  email: string;
  username: string;
}): string {
  const { sub, email, username } = params;
  const parsed = usernameSchema.safeParse(username);
  const local = email.split("@")[0].toLowerCase();
  if (parsed.success && !parsed.data.toLowerCase().includes(local)) {
    return parsed.data;
  }
  return `user-${createHash("sha256").update(sub).digest("hex").slice(0, 8)}`;
}

const router = Router();

// `uiPreferences.tripLogCustomFields` / `.placeCustomFields` are a PROJECTION,
// not storage: the definitions live in `custom_field_defs` and are read back
// onto the response under the two key names the web and mobile already consume
// (`customFieldDefsOf`, `App.tsx`). Keeping the response shape meant not
// rewriting every custom-field dialog in the frontend for a change that is
// entirely about where the rows live.
//
// This also keeps the APP 12 data export complete — it serializes the user
// through here, so a user's field definitions leave with the rest of their data.
async function serializeUserForResponse(
  user: {
    id: string;
    storageUsedBytes: bigint;
    storageQuotaBytes: bigint;
    uiPreferences: Prisma.JsonValue;
  } & Record<string, unknown>,
) {
  return {
    ...user,
    storageUsedBytes: Number(user.storageUsedBytes),
    storageQuotaBytes: Number(user.storageQuotaBytes),
    uiPreferences: {
      ...normalizeUserUiPreferences(user.uiPreferences),
      ...(await defsForUserResponse(user.id)),
    },
  };
}

// serializeUserForResponse + the derived monthly-usage fields.
//
// None of these are columns: credit usage is a live sum over the three worker
// job tables (see lib/computeCredits.ts), and egress applies the same lazy
// month rollover the sweeper's write does. Both GET and PATCH /me return them
// so the cached user the frontend keeps never loses its meters after a
// profile update.
async function serializeUserWithUsage(
  user: Parameters<typeof serializeUserForResponse>[0] & {
    id: string;
    monthlyComputeCredits: number;
  },
) {
  const [credits, egress] = await Promise.all([
    getMonthlyCreditUsage(user.id, user.monthlyComputeCredits),
    getEgressUsage(user.id),
  ]);
  return {
    ...(await serializeUserForResponse(user)),
    monthlyComputeCredits: credits.quota,
    currentConsentVersion: CURRENT_CONSENT_VERSION,
    monthlyComputeUsage: credits.used,
    monthlyComputeResetAt: credits.resetAt,
    // Egress has no progress bar in the UI — the cap sits far above real use
    // and is surfaced only by notification. These ship anyway so a client can
    // explain a 429 without a second round trip.
    monthlyEgressQuotaBytes: egress.quota.toString(),
    monthlyEgressUsedBytes: egress.used.toString(),
  };
}

// GET /users/username-available — yes or no, before an account exists, so the
// sign-up form can say a name is taken before the email code rather than after.
// No auth, by the exception in api/AGENTS.md. lower() is the unique index's own
// expression, and Prisma's insensitive mode (ILIKE) would not use it.
router.get(
  "/username-available",
  usernameCheckLimiter,
  async (req, res: Response) => {
    const parsed = usernameSchema.safeParse(req.query.username);
    if (!parsed.success) throw new AppError(400, USERNAME_RULE);
    const rows = await prisma.$queryRaw<unknown[]>`
      SELECT 1 FROM users WHERE lower(username) = lower(${parsed.data}) LIMIT 1`;
    res.json({ available: rows.length === 0 });
  },
);

// GET /users/me — get current user's profile
// Creates the user in DB if it's their first request (post-Cognito signup)
router.get(
  "/me",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const { sub, email, username } = req.user!;

    let user = await prisma.user.findUnique({
      where: { cognitoId: sub },
    });

    // First time this user has hit the API — create their DB record.
    const initialUsername = initialUsernameFor({ sub, email, username });

    if (!user) {
      // Resolve provisioning deterministically rather than depending on which
      // unique constraint Postgres reports first. An orphaned row owned by this
      // email (the previous Cognito user was deleted but its DB row left behind)
      // MUST be detected before attempting a create: otherwise a colliding
      // username is reported first, the create retries with a suffix, then hits
      // the email unique and hard-fails — never reaching the rebind path this
      // case exists for.
      const emailOwner = await prisma.user.findUnique({
        where: { email },
        select: { id: true, cognitoId: true },
      });

      if (emailOwner && emailOwner.cognitoId !== sub) {
        // A row exists for this email under a different sub. Rebind it
        // to the new sub only when the inbound JWT is email-verified AND the
        // previous identity no longer exists at the provider (account deleted + recreated).
        // Any other case returns 409 to prevent account takeover.
        const oldSub = emailOwner.cognitoId;
        const canRebind =
          req.user!.emailVerified &&
          !(await identityProvider().userExists(oldSub));

        if (!canRebind) {
          throw new AppError(
            409,
            say`An account already exists for this email address. Contact support if you think that's a mistake.`,
          );
        }

        logger.warn(
          { oldSubHash: shortHash(oldSub), newSubHash: shortHash(sub) },
          "identity_rebind",
        );
        user = await prisma.user.update({
          where: { id: emailOwner.id },
          data: { cognitoId: sub, subject: sub },
        });
      } else {
        // No row owns this email (or a concurrent request for this same sub is
        // mid-create). Create ours, tolerating a username taken by a different
        // user and the concurrent-first-login race.
        user = await createUserForSignup({ sub, email, initialUsername });
      }
    } else if (user.email !== email) {
      // Only sync email from Cognito — username is managed by the user via PATCH /users/me
      try {
        user = await prisma.user.update({
          where: { id: user.id },
          data: { email },
        });
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === "P2002"
        ) {
          throw new AppError(
            409,
            say`That email is already linked to another account.`,
          );
        }
        throw e;
      }
    }

    res.json(await serializeUserWithUsage(user));
  },
);

// PATCH /users/me — update current user's profile
router.patch(
  "/me",
  requireAuth,
  userPatchLimiter,
  async (req: AuthenticatedRequest, res: Response) => {
    const { sub } = req.user!;
    // `tripLogCustomFields` / `placeCustomFields` are rejected here rather than
    // silently ignored: definitions cannot be updated as a whole list because
    // the whole-list shape cannot express `placeTypeIds`, `appliesToAllTypes`,
    // or system field ownership. Definitions are rows in `custom_field_defs`;
    // the row-grain endpoints in routes/customFields.ts and sync push ops are
    // the write paths. A client sending the old key gets a 400 naming the
    // replacement rather than a silent no-op.
    const {
      username,
      themeSchemeId,
      notifications,
      importMergePolicy,
      copyPlaceMedia,
      leaderboardOptIn,
      slopeBands,
      consentVersion,
    } = req.body as {
      username?: unknown;
      themeSchemeId?: unknown;
      notifications?: unknown;
      importMergePolicy?: unknown;
      copyPlaceMedia?: unknown;
      leaderboardOptIn?: unknown;
      slopeBands?: unknown;
      consentVersion?: unknown;
    };
    for (const legacy of [
      "tripLogCustomFields",
      "placeCustomFields",
    ] as const) {
      if ((req.body as Record<string, unknown>)[legacy] !== undefined) {
        throw malformed(
          `${legacy} is no longer accepted here — use /custom-fields/:entity.`,
        );
      }
    }

    const user = await resolveUser(sub);

    const updates: {
      username?: string;
      uiPreferences?: Prisma.InputJsonValue;
      consentedAt?: Date;
      consentVersion?: string;
    } = {};

    if (consentVersion !== undefined) {
      // Only accept consent recorded against the server's current version.
      // Rejecting arbitrary/stale strings keeps the consent record trustworthy
      // (self-attestation otherwise lets a client stamp any version).
      if (
        typeof consentVersion !== "string" ||
        consentVersion !== CURRENT_CONSENT_VERSION
      ) {
        throw malformed("Invalid consentVersion");
      }
      updates.consentVersion = consentVersion;
      updates.consentedAt = new Date();
    }

    if (username !== undefined) {
      const parsed = usernameSchema.safeParse(username);
      if (!parsed.success) {
        throw new AppError(400, USERNAME_RULE);
      }
      updates.username = parsed.data;
    }

    if (
      themeSchemeId !== undefined ||
      notifications !== undefined ||
      importMergePolicy !== undefined ||
      copyPlaceMedia !== undefined ||
      leaderboardOptIn !== undefined ||
      slopeBands !== undefined
    ) {
      // An older client may still send a retired id; it is stored as the
      // scheme it became.
      const nextThemeSchemeId =
        themeSchemeId === undefined
          ? undefined
          : normalizeThemeSchemeId(themeSchemeId);
      if (themeSchemeId !== undefined && nextThemeSchemeId == null) {
        throw malformed("Invalid themeSchemeId");
      }
      if (
        notifications !== undefined &&
        !isNotificationPreferences(notifications)
      ) {
        throw malformed("Invalid notifications");
      }
      if (copyPlaceMedia !== undefined && typeof copyPlaceMedia !== "boolean") {
        throw malformed("Invalid copyPlaceMedia");
      }
      if (
        leaderboardOptIn !== undefined &&
        typeof leaderboardOptIn !== "boolean"
      ) {
        throw malformed("Invalid leaderboardOptIn");
      }
      if (Array.isArray(slopeBands) && slopeBands.length > MAX_SLOPE_BANDS) {
        throw malformed(`At most ${MAX_SLOPE_BANDS} slopeBands`, 413);
      }
      const nextSlopeBands =
        slopeBands === undefined ? undefined : parseSlopeBands(slopeBands);
      if (nextSlopeBands === null) {
        throw malformed("Invalid slopeBands");
      }
      if (importMergePolicy !== undefined) {
        const normalized = normalizeImportMergePolicy(importMergePolicy);
        if (!normalized) {
          throw malformed("Invalid importMergePolicy");
        }
      }

      const current = normalizeUserUiPreferences(user.uiPreferences);
      updates.uiPreferences = {
        ...current,
        // The projection this object was built from carries the two custom
        // field keys; drop them so they are never written back to storage.
        tripLogCustomFields: undefined,
        placeCustomFields: undefined,
        ...(nextThemeSchemeId ? { themeSchemeId: nextThemeSchemeId } : {}),
        ...(notifications !== undefined
          ? {
              notifications: {
                ...current.notifications,
                ...(notifications as Record<string, boolean>),
              },
            }
          : {}),
        ...(copyPlaceMedia !== undefined ? { copyPlaceMedia } : {}),
        ...(leaderboardOptIn !== undefined ? { leaderboardOptIn } : {}),
        ...(nextSlopeBands ? { slopeBands: nextSlopeBands } : {}),
        ...(importMergePolicy !== undefined
          ? { importMergePolicy: normalizeImportMergePolicy(importMergePolicy) }
          : {}),
      };
    }

    if (Object.keys(updates).length === 0) {
      throw malformed("No valid update fields provided");
    }

    let updated;
    try {
      updated = await prisma.user.update({
        where: { cognitoId: sub },
        data: updates,
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      ) {
        // The username is the only unique column this route writes.
        // `meta.target` does not name the column under the driver adapter, so
        // any P2002 here indicates a taken username (users.test.ts).
        throw new AppError(409, USERNAME_TAKEN);
      }
      throw e;
    }

    res.json(await serializeUserWithUsage(updated));
  },
);

// GET /users/me/export — download the current user's data as JSON. What it
// covers, and the guard that keeps it covering new tables: lib/dataExport.ts.
router.get(
  "/me/export",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const { sub } = req.user!;
    const user = await resolveUser(sub);

    const payload = {
      exportedAt: new Date().toISOString(),
      schemaVersion: EXPORT_SCHEMA_VERSION,
      user: await serializeUserForResponse(user),
      ...(await loadExportSections(user.id)),
    };

    const filename = `logjam-export-${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.json(
      JSON.parse(
        JSON.stringify(payload, (_, v) =>
          typeof v === "bigint" ? Number(v) : v,
        ),
      ),
    );
  },
);

// DELETE /users/me — permanently delete the current user's account and all data
router.delete(
  "/me",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const { sub } = req.user!;

    const user = await resolveUser(sub);

    // Pre-fetch every S3 pointer the user owns BEFORE touching the DB. Once the
    // rows are deleted the keys are unrecoverable, so cleanup must run S3-first:
    // if an S3 delete throws, the DB rows still exist and a retried DELETE /me
    // can re-derive the keys — no orphaned objects, no lost keys.
    const [
      topoJobs,
      topoExportJobs,
      media,
      ownedPlaces,
      friendships,
      sharesOut,
      sharesIn,
      directSharesOut,
      placeLinkedRoutes,
    ] = await Promise.all([
      prisma.topoJob.findMany({
        where: { userId: user.id },
        select: { id: true },
      }),
      prisma.topoExportJob.findMany({
        where: { userId: user.id },
        select: { id: true, resultKey: true },
      }),
      // linkedType/linkedId feed the sync-tombstone fan-out below (which
      // place each media row belonged to).
      prisma.media.findMany({
        where: { ownerId: user.id },
        select: {
          id: true,
          linkedType: true,
          linkedId: true,
          s3KeyDisplay: true,
          s3KeyThumbnail: true,
        },
      }),
      // Place IDs and friendship IDs are needed to purge cross-user
      // notifications that reference this user's data; the party
      // ids feed the sync-tombstone fan-out (counterparts must forget the
      // friendship edge).
      prisma.place.findMany({
        where: { ownerId: user.id },
        select: { id: true },
      }),
      prisma.friendship.findMany({
        where: {
          OR: [{ requesterId: user.id }, { addresseeId: user.id }],
        },
        select: { id: true, requesterId: true, addresseeId: true },
      }),
      // Shares of places this user OWNS: each sharee's mirror must forget the
      // place + its place-level media (sync tombstones).
      prisma.placeShare.findMany({
        where: { place: { ownerId: user.id } },
        select: { placeId: true, sharedWithId: true },
      }),
      // Shares this user RECEIVED: the place owner's mirror must forget the
      // share row.
      prisma.placeShare.findMany({
        where: { sharedWithId: user.id },
        select: { id: true, sharedById: true },
      }),
      // Direct shares of synced entities this user OWNS. The account delete is
      // a delete site like any other, so each recipient's mirror must forget
      // the route (the Share row itself cascades away with the user, but a
      // cascade writes no tombstone). Jobs are excluded: they are not synced
      // entities, so there is no mirror row to revoke.
      prisma.share.findMany({
        where: { sharedById: user.id, entityType: "route" },
        select: { entityType: true, entityId: true, sharedWithId: true },
      }),
      // Routes are hard-deleted below and a place sharee could see them
      // through `Route.placeId`. The place tombstone does NOT imply them — the
      // single-place delete path fans them out explicitly — so they need their
      // own rows or the sharee's mirror keeps the geometry forever.
      //
      // PlaceLinks need no equivalent: they are owner-private, and the owner is
      // the account going away.
      prisma.route.findMany({
        where: { ownerId: user.id, placeId: { not: null } },
        select: {
          id: true,
          place: { select: { shares: { select: { sharedWithId: true } } } },
        },
      }),
    ]);

    const ownedPlaceIds = ownedPlaces.map((c) => c.id);
    const friendshipIds = friendships.map((f) => f.id);

    const mediaKeys = media.flatMap((m) =>
      [m.s3KeyDisplay, m.s3KeyThumbnail].filter((k): k is string => Boolean(k)),
    );
    const exportResultKeys = topoExportJobs
      .map((e) => e.resultKey)
      .filter((k): k is string => Boolean(k));

    // S3 cleanup first. The deletes throw on failure (see lib/s3Cleanup.ts), so
    // any error here aborts before the DB transaction — the account is not
    // deleted and the user can retry. Belt-and-braces against bucket-lifecycle
    // drift, not a substitute for it. The multipart abort inside
    // deleteTopoJobObjects is best-effort; the abort-incomplete-uploads
    // lifecycle rule clears what it misses.
    await Promise.all([
      deleteS3Keys(MEDIA_BUCKET, mediaKeys),
      deleteS3Keys(TOPO_BUCKET, exportResultKeys),
      ...topoJobs.map(({ id }) => deleteTopoJobObjects(TOPO_BUCKET, id)),
      ...topoExportJobs.map(({ id }) =>
        deleteS3Prefix(TOPO_BUCKET, `exports/${id}/`),
      ),
      // Sent copies live in the MEDIA bucket under file-sends/{senderId}/.
      // One prefix delete covers every send, including one whose upload was
      // presigned but never confirmed (no row, so the per-id list above would
      // miss it). The lifecycle rule would eventually collect these; this is
      // the same belt-and-braces the topo prefixes get.
      deleteS3Prefix(MEDIA_BUCKET, `file-sends/${user.id}/`),
    ]);

    // The user-owned FKs are now ON DELETE CASCADE (see migration
    // 20260604000000_add_fk_indexes_and_cascades), so `user.delete` alone
    // removes every child row. The explicit deleteMany calls are retained as
    // defense-in-depth and to keep the delete deterministic if a future child
    // table is added without a cascade. `Media` has a polymorphic linkedId with
    // no DB FK, so its row delete MUST stay explicit.
    // Sync tombstones for OTHER users' mirrors: the deleted user's
    // own tombstones are pointless (the cascade wipes their account, and
    // SyncTombstone.userId cascades too), so every row here targets a
    // counterpart. Ids only — never names/coords.
    const mediaIdsByPlace = new Map<string, string[]>();
    for (const m of media) {
      const placeId = placeIdOfMedia(m);
      if (placeId === null) continue;
      const list = mediaIdsByPlace.get(placeId) ?? [];
      list.push(m.id);
      mediaIdsByPlace.set(placeId, list);
    }
    const placeInheritedOut = placeLinkedRoutes.flatMap((route) => {
      const userIds = (route.place?.shares ?? []).map((s) => s.sharedWithId);
      return userIds.length > 0
        ? [{ entityType: "route" as const, entityId: route.id, userIds }]
        : [];
    });

    const accountTombstones = accountDeleteTombstones({
      userId: user.id,
      placeInheritedOut,
      mediaIdsByPlace,
      placeSharesOut: sharesOut,
      placeSharesIn: sharesIn,
      friendships,
      // Share.entityType is a plain string column; the query above already
      // restricted it to the one synced type, so this narrows rather than
      // widens.
      directSharesOut: directSharesOut.flatMap((share) =>
        share.entityType === "route"
          ? [{ ...share, entityType: share.entityType }]
          : [],
      ),
    });

    await prisma.$transaction([
      ...(accountTombstones.length > 0
        ? [prisma.syncTombstone.createMany({ data: accountTombstones })]
        : []),
      // The deleted user's own tombstone log (rows other users' deletes wrote
      // FOR this user) — cascade covers it; explicit per account-delete convention.
      prisma.syncTombstone.deleteMany({ where: { userId: user.id } }),
      prisma.notification.deleteMany({ where: { userId: user.id } }),
      // Purge notifications held by OTHER users that reference this user's data:
      // place_shared rows pointing at any of the deleted user's
      // places, and friend_request(_accepted) rows pointing at any friendship
      // this user was party to. The cascade removes the places/shares/
      // friendships but not the recipient's denormalised notification rows.
      ...(ownedPlaceIds.length > 0
        ? [
            prisma.notification.deleteMany({
              where: {
                type: "place_shared",
                OR: ownedPlaceIds.map((placeId) => ({
                  payload: { path: ["placeId"], equals: placeId },
                })),
              },
            }),
          ]
        : []),
      ...(friendshipIds.length > 0
        ? [
            prisma.notification.deleteMany({
              where: {
                type: { in: ["friend_request", "friend_request_accepted"] },
                OR: friendshipIds.map((friendshipId) => ({
                  payload: { path: ["friendshipId"], equals: friendshipId },
                })),
              },
            }),
          ]
        : []),
      // Direct shares and file sends this user made: the Share and
      // FileSendRecipient rows cascade, the recipients' notification rows do
      // not. Both payloads carry the sender's id.
      prisma.notification.deleteMany({
        where: {
          OR: [
            {
              type: "item_shared",
              payload: { path: ["sharedById"], equals: user.id },
            },
            {
              type: "file_sent",
              payload: { path: ["sentById"], equals: user.id },
            },
          ],
        },
      }),
      prisma.placeShare.deleteMany({
        where: { OR: [{ sharedById: user.id }, { sharedWithId: user.id }] },
      }),
      prisma.friendship.deleteMany({
        where: { OR: [{ requesterId: user.id }, { addresseeId: user.id }] },
      }),
      // Unspent invite links die with the account that issued them.
      prisma.friendInvite.deleteMany({ where: { inviterId: user.id } }),
      prisma.topoJob.deleteMany({ where: { userId: user.id } }),
      prisma.topoExportJob.deleteMany({ where: { userId: user.id } }),
      prisma.fileSend.deleteMany({ where: { senderId: user.id } }),
      prisma.media.deleteMany({ where: { ownerId: user.id } }),
      // Explicit even though TripLogPlace.tripLogId cascades on TripLog
      // delete — account-delete convention: never rely solely on an implicit
      // cascade for the account-delete purge list.
      prisma.tripLogPlace.deleteMany({
        where: { tripLog: { userId: user.id } },
      }),
      // Explicit even though every relation cascades.
      prisma.importSnapshot.deleteMany({ where: { ownerId: user.id } }),
      prisma.tripLog.deleteMany({ where: { userId: user.id } }),
      prisma.place.deleteMany({ where: { ownerId: user.id } }),
      prisma.topoTemplate.deleteMany({ where: { userId: user.id } }),
      prisma.deviceToken.deleteMany({ where: { userId: user.id } }),
      // Routes store their geometry on the row, so there is no S3 leg here.
      // No S3 objects involved; explicit per convention even though the
      // cascade covers the rows.
      prisma.route.deleteMany({ where: { ownerId: user.id } }),
      // Links between this account's places. Owner-private, no S3 leg, no
      // tombstone fan-out — the only viewer is the account being deleted.
      prisma.placeLink.deleteMany({ where: { ownerId: user.id } }),
      // Custom field definitions: user-authored labels, no S3 leg, and never
      // shared — so no tombstone fan-out either, the only viewer is the
      // account being deleted. Explicit per convention even though the FK
      // cascade covers the rows.
      prisma.customFieldDef.deleteMany({ where: { ownerId: user.id } }),
      prisma.user.delete({ where: { id: user.id } }),
    ]);

    // Logjam's data is gone either way; the identity at the provider is a
    // clean-up we report but never fail the request over.
    try {
      await identityProvider().deleteUser(sub);
    } catch (err) {
      logger.warn({ err: safeErrorForLog(err) }, "identity_delete_failed");
    }

    res.status(204).end();
  },
);

export default router;
