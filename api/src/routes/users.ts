import { Router, Response } from "express";
import { createHash } from "crypto";
import { Prisma, User } from "@prisma/client";
import { z } from "zod";
import {
  isThemeSchemeId,
  normalizeUserUiPreferences,
  normalizeImportMergePolicy,
  isTripLogCustomFieldDef,
  isNotificationPreferences,
} from "@logjam/shared";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import { userPatchLimiter } from "../middleware/rateLimit";
import { cognitoIdp } from "../services/awsClients";
import { getWeeklyTileUsage } from "../lib/tileQuota";
import { CURRENT_CONSENT_VERSION } from "../constants/consent";
import { getEnv } from "../lib/env";
import { deleteS3Keys, deleteS3Prefix } from "../lib/s3Cleanup";
import { logger } from "../lib/logger";

const MEDIA_BUCKET = getEnv().S3_BUCKET_MEDIA ?? "";
const TOPO_BUCKET = getEnv().S3_BUCKET_TOPO ?? "";
import { AdminGetUserCommand, UserNotFoundException } from "@aws-sdk/client-cognito-identity-provider";

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

async function cognitoUserExists(sub: string): Promise<boolean> {
  const poolId = process.env.COGNITO_USER_POOL_ID;
  if (!poolId) return true; // fail safe: assume exists if pool not configured
  try {
    await cognitoIdp.send(new AdminGetUserCommand({ UserPoolId: poolId, Username: sub }));
    return true;
  } catch (err) {
    if (err instanceof UserNotFoundException) return false;
    // IAM not granted or network error — fail safe: treat as existing
    return true;
  }
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
  // Substring match so it works whether Postgres reports the field name
  // ("username") or the constraint name ("User_username_key").
  const targetHas = (e: Prisma.PrismaClientKnownRequestError, name: string) =>
    ((e.meta?.target as string[] | undefined) ?? []).some((t) =>
      t.includes(name),
    );
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
        data: { cognitoId: sub, email, username: candidateUsernames[attempt] },
      });
    } catch (e) {
      if (
        !(e instanceof Prisma.PrismaClientKnownRequestError) ||
        e.code !== "P2002"
      ) {
        throw e;
      }

      if (targetHas(e, "email")) {
        // Email got owned between the pre-check and now. If a concurrent
        // request for this same sub created it, use that row; otherwise a
        // genuinely different account owns the email.
        const racing = await recoverRacingRow();
        if (racing) return racing;
        throw new AppError(
          409,
          "An account exists for this email address. Contact support if you believe this is an error.",
        );
      }

      if (targetHas(e, "username")) {
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
  throw new AppError(500, "Failed to provision user");
}

const usernameSchema = z
  .string()
  .trim()
  .min(3, "Username must be at least 3 characters")
  .max(32, "Username must be at most 32 characters")
  .regex(
    /^[A-Za-z0-9_.-]+$/,
    "Username may only contain letters, numbers, underscores, dots, and dashes",
  );

const router = Router();

function serializeUserForResponse(
  user: {
    storageUsedBytes: bigint;
    storageQuotaBytes: bigint;
    uiPreferences: Prisma.JsonValue;
  } & Record<string, unknown>,
) {
  return {
    ...user,
    storageUsedBytes: Number(user.storageUsedBytes),
    storageQuotaBytes: Number(user.storageQuotaBytes),
    uiPreferences: normalizeUserUiPreferences(user.uiPreferences),
  };
}

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
    // Prefer preferred_username from Cognito; fall back to email prefix rather
    // than raw cognito:username which can be an auto-generated UUID.
    const isUUID = (s: string) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
    const initialUsername =
      username && !isUUID(username) ? username : email.split("@")[0];

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
        // A row exists for this email under a different Cognito sub. Rebind it
        // to the new sub only when the inbound JWT is email-verified AND the
        // previous Cognito user no longer exists (account deleted + recreated).
        // Any other case returns 409 to prevent account takeover.
        const oldSub = emailOwner.cognitoId;
        const canRebind =
          req.user!.emailVerified && !(await cognitoUserExists(oldSub));

        if (!canRebind) {
          throw new AppError(
            409,
            "An account exists for this email address. Contact support if you believe this is an error.",
          );
        }

        logger.warn(
          { oldSubHash: shortHash(oldSub), newSubHash: shortHash(sub) },
          "cognito_rebind",
        );
        user = await prisma.user.update({
          where: { id: emailOwner.id },
          data: { cognitoId: sub },
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
            "That email is already linked to another account.",
          );
        }
        throw e;
      }
    }

    const tileUsage = await getWeeklyTileUsage(user.id, user.weeklyTileQuota);
    res.json({
      ...serializeUserForResponse(user),
      weeklyTileQuota: tileUsage.quota,
      weeklyTileUsage: tileUsage.used,
      weeklyTileResetAt: tileUsage.resetAt,
    });
  },
);

// PATCH /users/me — update current user's profile
router.patch(
  "/me",
  requireAuth,
  userPatchLimiter,
  async (req: AuthenticatedRequest, res: Response) => {
    const { sub } = req.user!;
    const { username, themeSchemeId, tripLogCustomFields, canyonCustomFields, notifications, autoDownloadGeoPdfs, importMergePolicy, consentVersion } = req.body as {
      username?: unknown;
      themeSchemeId?: unknown;
      tripLogCustomFields?: unknown;
      canyonCustomFields?: unknown;
      notifications?: unknown;
      autoDownloadGeoPdfs?: unknown;
      importMergePolicy?: unknown;
      consentVersion?: unknown;
    };

    const user = await prisma.user.findUnique({ where: { cognitoId: sub } });
    if (!user) throw new AppError(404, "User not found");

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
        throw new AppError(400, "Invalid consentVersion");
      }
      updates.consentVersion = consentVersion;
      updates.consentedAt = new Date();
    }

    if (username !== undefined) {
      const parsed = usernameSchema.safeParse(username);
      if (!parsed.success) {
        throw new AppError(400, parsed.error.issues[0]?.message ?? "Invalid username");
      }
      updates.username = parsed.data;
    }

    if (
      themeSchemeId !== undefined ||
      tripLogCustomFields !== undefined ||
      canyonCustomFields !== undefined ||
      notifications !== undefined ||
      autoDownloadGeoPdfs !== undefined ||
      importMergePolicy !== undefined
    ) {
      if (themeSchemeId !== undefined && !isThemeSchemeId(themeSchemeId)) {
        throw new AppError(400, "Invalid themeSchemeId");
      }
      if (tripLogCustomFields !== undefined) {
        if (
          !Array.isArray(tripLogCustomFields) ||
          !tripLogCustomFields.every(isTripLogCustomFieldDef)
        ) {
          throw new AppError(400, "Invalid tripLogCustomFields");
        }
      }
      if (canyonCustomFields !== undefined) {
        if (
          !Array.isArray(canyonCustomFields) ||
          !canyonCustomFields.every(isTripLogCustomFieldDef)
        ) {
          throw new AppError(400, "Invalid canyonCustomFields");
        }
      }
      if (notifications !== undefined && !isNotificationPreferences(notifications)) {
        throw new AppError(400, "Invalid notifications");
      }
      if (autoDownloadGeoPdfs !== undefined && typeof autoDownloadGeoPdfs !== "boolean") {
        throw new AppError(400, "Invalid autoDownloadGeoPdfs");
      }
      if (importMergePolicy !== undefined) {
        const normalized = normalizeImportMergePolicy(importMergePolicy);
        if (!normalized) {
          throw new AppError(400, "Invalid importMergePolicy");
        }
      }

      const current = normalizeUserUiPreferences(user.uiPreferences);
      updates.uiPreferences = {
        ...current,
        ...(themeSchemeId !== undefined ? { themeSchemeId } : {}),
        ...(tripLogCustomFields !== undefined ? { tripLogCustomFields } : {}),
        ...(canyonCustomFields !== undefined ? { canyonCustomFields } : {}),
        ...(notifications !== undefined
          ? { notifications: { ...current.notifications, ...(notifications as Record<string, boolean>) } }
          : {}),
        ...(autoDownloadGeoPdfs !== undefined ? { autoDownloadGeoPdfs } : {}),
        ...(importMergePolicy !== undefined ? { importMergePolicy: normalizeImportMergePolicy(importMergePolicy) } : {}),
      };
    }

    if (Object.keys(updates).length === 0) {
      throw new AppError(400, "No valid update fields provided");
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
        const target = (e.meta?.target as string[] | undefined) ?? [];
        if (target.includes("username")) {
          throw new AppError(409, "Username taken.");
        }
        throw new AppError(409, "Conflict updating profile.");
      }
      throw e;
    }

    res.json(serializeUserForResponse(updated));
  },
);

// GET /users/me/export — download all data owned by the current user as JSON.
// Media file content (S3 blobs) is intentionally excluded; only metadata.
router.get(
  "/me/export",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const { sub } = req.user!;
    const user = await prisma.user.findUnique({ where: { cognitoId: sub } });
    if (!user) throw new AppError(404, "User not found");

    const [
      canyons,
      tripLogs,
      geoPdfTemplates,
      sharesGiven,
      sharesReceived,
      media,
      topoJobs,
      topoExportJobs,
      topoTemplates,
      notifications,
    ] = await Promise.all([
      prisma.canyon.findMany({ where: { ownerId: user.id } }),
      prisma.tripLog.findMany({ where: { userId: user.id } }),
      prisma.geoPdfTemplate.findMany({ where: { userId: user.id } }),
      prisma.canyonShare.findMany({
        where: { sharedById: user.id },
        include: { sharedWith: { select: { id: true, username: true } } },
      }),
      prisma.canyonShare.findMany({
        where: { sharedWithId: user.id },
        include: { sharedBy: { select: { id: true, username: true } } },
      }),
      prisma.media.findMany({ where: { ownerId: user.id } }),
      // PRIV-004: privacy.html promises a *complete* copy (APP 12). Topo jobs
      // carry location-bearing personal information (footprint geometry,
      // user-typed names) and must be included, along with export jobs,
      // topo templates, and notifications (reference-IDs-only payloads).
      prisma.topoJob.findMany({ where: { userId: user.id } }),
      prisma.topoExportJob.findMany({ where: { userId: user.id } }),
      prisma.topoTemplate.findMany({ where: { userId: user.id } }),
      prisma.notification.findMany({ where: { userId: user.id } }),
    ]);

    const payload = {
      exportedAt: new Date().toISOString(),
      // v2: adds topoJobs, topoExportJobs, topoTemplates, notifications.
      schemaVersion: 2,
      user: serializeUserForResponse(user),
      canyons,
      tripLogs,
      geoPdfTemplates,
      sharesGiven,
      sharesReceived,
      // Media metadata only; file content not included. To download media bytes,
      // request a presigned URL per item via GET /media/:id (future schemaVersion).
      media: media.map((m) => ({
        ...m,
        fileSizeBytes: Number(m.fileSizeBytes),
      })),
      // Topo job records identify their tile outputs (S3 keys are job-UUID
      // paths, no coordinates); tile files themselves are not included.
      topoJobs,
      topoExportJobs,
      topoTemplates,
      notifications,
    };

    const filename = `logjam-export-${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.json(JSON.parse(JSON.stringify(payload, (_, v) => (typeof v === "bigint" ? Number(v) : v))));
  },
);

// DELETE /users/me — permanently delete the current user's account and all data
router.delete(
  "/me",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const { sub } = req.user!;

    const user = await prisma.user.findUnique({ where: { cognitoId: sub } });
    if (!user) throw new AppError(404, "User not found");

    // Pre-fetch every S3 pointer the user owns BEFORE touching the DB. Once the
    // rows are deleted the keys are unrecoverable, so cleanup must run S3-first:
    // if an S3 delete throws, the DB rows still exist and a retried DELETE /me
    // can re-derive the keys (ARCH-004 — no orphaned objects, no lost keys).
    const [topoJobs, topoExportJobs, geoPdfJobs, media, ownedCanyons, friendships] =
      await Promise.all([
        prisma.topoJob.findMany({ where: { userId: user.id }, select: { id: true } }),
        prisma.topoExportJob.findMany({
          where: { userId: user.id },
          select: { id: true, resultKey: true },
        }),
        prisma.geoPdfJob.findMany({ where: { userId: user.id }, select: { id: true } }),
        prisma.media.findMany({
          where: { ownerId: user.id },
          select: { s3KeyDisplay: true, s3KeyThumbnail: true },
        }),
        // Canyon IDs and friendship IDs are needed to purge cross-user
        // notifications that reference this user's data (PRIV-003).
        prisma.canyon.findMany({
          where: { ownerId: user.id },
          select: { id: true },
        }),
        prisma.friendship.findMany({
          where: {
            OR: [{ requesterId: user.id }, { addresseeId: user.id }],
          },
          select: { id: true },
        }),
      ]);

    const ownedCanyonIds = ownedCanyons.map((c) => c.id);
    const friendshipIds = friendships.map((f) => f.id);

    const mediaKeys = media.flatMap((m) =>
      [m.s3KeyDisplay, m.s3KeyThumbnail].filter((k): k is string => Boolean(k)),
    );
    const exportResultKeys = topoExportJobs
      .map((e) => e.resultKey)
      .filter((k): k is string => Boolean(k));

    // S3 cleanup first. The helpers throw on failure (see lib/s3Cleanup.ts), so
    // any error here aborts before the DB transaction — the account is not
    // deleted and the user can retry. Belt-and-braces against bucket-lifecycle
    // drift, not a substitute for it.
    await Promise.all([
      deleteS3Keys(MEDIA_BUCKET, mediaKeys),
      deleteS3Keys(TOPO_BUCKET, exportResultKeys),
      ...topoJobs.flatMap(({ id }) => [
        deleteS3Prefix(TOPO_BUCKET, `inputs/${id}/`),
        deleteS3Prefix(TOPO_BUCKET, `outputs/${id}/`),
        deleteS3Prefix(TOPO_BUCKET, `jobs/${id}/`),
      ]),
      ...topoExportJobs.map(({ id }) =>
        deleteS3Prefix(TOPO_BUCKET, `exports/${id}/`),
      ),
      // GeoPDF outputs live under exports/geo-pdf/{jobId}/ (geoPdfWorker
      // resultKeyFor). Delete the whole per-job prefix, not just the recorded
      // resultKey, so an object uploaded by a running/failed job before its row
      // was recorded is still purged (ARCH-001).
      ...geoPdfJobs.map(({ id }) =>
        deleteS3Prefix(TOPO_BUCKET, `exports/geo-pdf/${id}/`),
      ),
    ]);

    // The user-owned FKs are now ON DELETE CASCADE (see migration
    // 20260604000000_add_fk_indexes_and_cascades), so `user.delete` alone
    // removes every child row. The explicit deleteMany calls are retained as
    // defense-in-depth and to keep the delete deterministic if a future child
    // table is added without a cascade. `Media` has a polymorphic linkedId with
    // no DB FK, so its row delete MUST stay explicit.
    await prisma.$transaction([
      prisma.notification.deleteMany({ where: { userId: user.id } }),
      // Purge notifications held by OTHER users that reference this user's data
      // (PRIV-003): canyon_shared rows pointing at any of the deleted user's
      // canyons, and friend_request(_accepted) rows pointing at any friendship
      // this user was party to. The cascade removes the canyons/shares/
      // friendships but not the recipient's denormalised notification rows.
      ...(ownedCanyonIds.length > 0
        ? [
            prisma.notification.deleteMany({
              where: {
                type: "canyon_shared",
                OR: ownedCanyonIds.map((canyonId) => ({
                  payload: { path: ["canyonId"], equals: canyonId },
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
      prisma.canyonShare.deleteMany({
        where: { OR: [{ sharedById: user.id }, { sharedWithId: user.id }] },
      }),
      prisma.friendship.deleteMany({
        where: { OR: [{ requesterId: user.id }, { addresseeId: user.id }] },
      }),
      prisma.topoJob.deleteMany({ where: { userId: user.id } }),
      prisma.topoExportJob.deleteMany({ where: { userId: user.id } }),
      prisma.geoPdfJob.deleteMany({ where: { userId: user.id } }),
      prisma.media.deleteMany({ where: { ownerId: user.id } }),
      prisma.tripLog.deleteMany({ where: { userId: user.id } }),
      prisma.canyon.deleteMany({ where: { ownerId: user.id } }),
      prisma.geoPdfTemplate.deleteMany({ where: { userId: user.id } }),
      prisma.topoTemplate.deleteMany({ where: { userId: user.id } }),
      prisma.user.delete({ where: { id: user.id } }),
    ]);

    res.status(204).end();
  },
);

export default router;
