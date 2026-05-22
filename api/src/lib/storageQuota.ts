import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";

export async function getStorageUsage(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { storageUsedBytes: true, storageQuotaBytes: true },
  });
  if (!user) throw new AppError(404, "User not found");
  return { used: user.storageUsedBytes, quota: user.storageQuotaBytes };
}

export async function assertHasStorageQuota(userId: string) {
  const { used, quota } = await getStorageUsage(userId);
  if (used >= quota) {
    throw new AppError(507, "Storage quota exceeded", { used: used.toString(), quota: quota.toString() });
  }
}

export async function decrementStorageUsed(userId: string, bytes: bigint): Promise<void> {
  if (bytes <= 0n) return;
  await prisma.$executeRaw`
    UPDATE users
    SET storage_used_bytes = GREATEST(0, storage_used_bytes - ${bytes})
    WHERE id = ${userId}
  `;
}
