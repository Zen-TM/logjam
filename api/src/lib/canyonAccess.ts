import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";

/**
 * Single source of the hybrid-share access decision (root CLAUDE.md):
 * - "owner"  → full access, including per-trip notes/media and the trip list.
 * - "shared" → canyon record + canyon-level notes/media ONLY. All per-trip
 *              data is owner-private.
 * - "none"   → no access.
 *
 * Every endpoint that serves canyon or trip-log data must derive its decision
 * from these helpers rather than re-implementing the owner/share checks inline
 * (SEC-001: the one inline re-derivation that drifted leaked owner-private
 * trip data to share recipients).
 */
export type CanyonRole = "owner" | "shared" | "none";

export async function getCanyonRole(
  userId: string,
  canyon: { id: string; ownerId: string },
): Promise<CanyonRole> {
  if (canyon.ownerId === userId) return "owner";
  const share = await prisma.canyonShare.findFirst({
    where: { canyonId: canyon.id, sharedWithId: userId },
    select: { id: true },
  });
  return share ? "shared" : "none";
}

/**
 * Assert the user is owner or share recipient; returns the resolved role so
 * callers can branch owner-vs-sharee response shaping. Throws 403 otherwise.
 */
export async function requireCanyonAccess(
  userId: string,
  canyon: { id: string; ownerId: string },
): Promise<Exclude<CanyonRole, "none">> {
  const role = await getCanyonRole(userId, canyon);
  if (role === "none") throw new AppError(403, "Access denied");
  return role;
}

/**
 * Assert the user owns the canyon. Owner-private resources (trip logs, trip
 * media) should pass a 404 denial so the response does not become an
 * existence oracle for IDs the caller is not allowed to see.
 */
export function requireCanyonOwner(
  userId: string,
  canyon: { ownerId: string },
  denial: AppError = new AppError(403, "Access denied"),
): void {
  if (canyon.ownerId !== userId) throw denial;
}
