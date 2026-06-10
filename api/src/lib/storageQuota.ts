import type { PrismaClient, Prisma } from "@prisma/client";
import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";

// All helpers accept an optional Prisma client so callers inside an
// interactive `prisma.$transaction(async (tx) => …)` can pass `tx` and make
// the quota mutation atomic with the row write it accounts for (Design Q).
// The default keeps standalone call sites unchanged.
export type DbClient = PrismaClient | Prisma.TransactionClient;

export async function getStorageUsage(userId: string, db: DbClient = prisma) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { storageUsedBytes: true, storageQuotaBytes: true },
  });
  if (!user) throw new AppError(404, "User not found");
  return { used: user.storageUsedBytes, quota: user.storageQuotaBytes };
}

/**
 * Throws 507 when the user has no storage headroom. With `pendingBytes` the
 * check covers a declared upcoming upload (`used + pendingBytes > quota`);
 * without it the legacy "already at/over quota" semantics apply. The
 * authoritative charge still happens at confirm against the real S3 size.
 */
export async function assertHasStorageQuota(
  userId: string,
  pendingBytes = 0n,
  db: DbClient = prisma,
) {
  const { used, quota } = await getStorageUsage(userId, db);
  if (used >= quota || used + pendingBytes > quota) {
    throw new AppError(507, "Storage quota exceeded", { used: used.toString(), quota: quota.toString() });
  }
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
