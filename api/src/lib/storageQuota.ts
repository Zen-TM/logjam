import { say } from "@logjam/shared";
import type { PrismaClient, Prisma } from "@prisma/client";
import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import { getEnv } from "./env";
import { logger } from "./logger";

// All helpers accept an optional Prisma client so callers inside an
// interactive `prisma.$transaction(async (tx) => …)` can pass `tx` and make
// the quota mutation atomic with the row write it accounts for.
// The default keeps standalone call sites unchanged.
export type DbClient = PrismaClient | Prisma.TransactionClient;

/** What a refusal for the site-wide storage cap says. */
const SITE_STORAGE_FULL_SENTENCE = say`The storage everyone on Logjam shares is full, so nothing new can be added right now. Try again later.`;

export async function getStorageUsage(userId: string, db: DbClient = prisma) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { storageUsedBytes: true, storageQuotaBytes: true },
  });
  if (!user)
    throw new AppError(
      404,
      say`Couldn't find your account. Sign out, then sign in again.`,
    );
  return { used: user.storageUsedBytes, quota: user.storageQuotaBytes };
}

/**
 * Throws 507 when the user has no storage headroom. With `pendingBytes` the
 * check covers a declared upcoming upload (`used + pendingBytes > quota`);
 * without it the legacy "already at/over quota" semantics apply. The
 * authoritative charge still happens at confirm against the real S3 size.
 * `freedBytes` is credited first: a write that deletes a file as it lands.
 */
export async function assertHasStorageQuota(
  userId: string,
  pendingBytes = 0n,
  db: DbClient = prisma,
  /** Bytes the same write frees first (a file it replaces). */
  freedBytes = 0n,
) {
  const { used: charged, quota } = await getStorageUsage(userId, db);
  const used = charged - freedBytes;
  if (used >= quota || used + pendingBytes > quota)
    throw storageFull(charged, quota);

  // The site-wide cap, after the user's own so a user over theirs is told that.
  // A 429 with no figures, not the 507: Logjam Web shows the sentence as is, and
  // Logjam GPS parks a 507 upload with "free some space", which deleting their
  // own files would not fix; it retries a 429 instead, and the cap can clear.
  const siteCap = getEnv().SITE_STORAGE_BYTES;
  if (siteCap === 0) return;
  // ponytail: a SUM over users per check, a scan per upload. Keep a running
  // total (or a materialised view) when users number in the tens of thousands.
  const { _sum } = await db.user.aggregate({
    _sum: { storageUsedBytes: true },
  });
  const siteUsed = (_sum.storageUsedBytes ?? 0n) - freedBytes;
  if (
    siteUsed >= BigInt(siteCap) ||
    siteUsed + pendingBytes > BigInt(siteCap)
  ) {
    // No user data in the line; no alarm watches it yet.
    logger.warn({ siteCap }, "site_storage_cap_reached");
    throw new AppError(429, SITE_STORAGE_FULL_SENTENCE);
  }
}

/** The 507 a write past the storage quota answers with. */
export function storageFull(used: bigint, quota: bigint): AppError {
  return new AppError(
    507,
    say`Your storage is full. Delete something to make room.`,
    { used: used.toString(), quota: quota.toString() },
  );
}

export async function decrementStorageUsed(
  userId: string,
  bytes: bigint,
  db: DbClient = prisma,
): Promise<void> {
  if (bytes <= 0n) return;
  await db.$executeRaw`
    UPDATE users
    SET storage_used_bytes = GREATEST(0, storage_used_bytes - ${bytes})
    WHERE id = ${userId}
  `;
}

export async function incrementStorageUsed(
  userId: string,
  bytes: bigint,
  db: DbClient = prisma,
): Promise<void> {
  if (bytes <= 0n) return;
  await db.$executeRaw`
    UPDATE users
    SET storage_used_bytes = storage_used_bytes + ${bytes}
    WHERE id = ${userId}
  `;
}

/**
 * Apply several users' storage changes (bytes, plus or minus) in user id
 * order, so two transactions changing the same users' storage lock their
 * rows in the same order and can't deadlock.
 * Guard: storageQuota.unit.test.ts ("in user id order").
 */
export async function applyStorageChanges(
  changes: Map<string, bigint>,
  db: DbClient = prisma,
): Promise<void> {
  const ordered = [...changes].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  for (const [userId, bytes] of ordered)
    if (bytes < 0n) await decrementStorageUsed(userId, -bytes, db);
    else await incrementStorageUsed(userId, bytes, db);
}
