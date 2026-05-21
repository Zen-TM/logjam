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
