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
 * callers can branch owner-vs-sharee response shaping. Throws 404 (not 403) when
 * the caller has no access, so the status is not an existence oracle for canyon
 * IDs the caller is not allowed to see (matches the trip-level 404 in
 * requireCanyonOwner).
 */
export async function requireCanyonAccess(
  userId: string,
  canyon: { id: string; ownerId: string },
): Promise<Exclude<CanyonRole, "none">> {
  const role = await getCanyonRole(userId, canyon);
  if (role === "none") throw new AppError(404, "Canyon not found");
  return role;
}

/**
 * Assert the user OWNS the canyon, for owner-only canyon-level actions
 * (edit/delete/share/list-shares). Role-aware denial closes the existence
 * oracle without lying to a sharee:
 *   none   → 404 (caller can't see this canyon at all)
 *   shared → 403 forbiddenMessage (caller sees it but lacks this permission)
 * For owner-private resources reached through a canyon use the sync
 * requireCanyonOwner below (404 by default).
 */
export async function requireCanyonOwnerAccess(
  userId: string,
  canyon: { id: string; ownerId: string },
  forbiddenMessage: string,
): Promise<void> {
  const role = await getCanyonRole(userId, canyon);
  if (role === "none") throw new AppError(404, "Canyon not found");
  if (role !== "owner") throw new AppError(403, forbiddenMessage);
}

/**
 * Assert the user owns the canyon, for owner-private resources reached through
 * one (trip logs, trip media). NO CURRENT CALL SITE — the nested single-trip
 * route it was written for is gone, and routes/tripLogs.ts does the same check
 * inline against getCanyonRole.
 *
 * The default denial is a 404 ON PURPOSE (PRIV-102): the whole point of an
 * owner-private resource is that its existence is not confirmable, so the
 * lazy call — no `denial` argument — has to be the safe one. Pass a 403
 * explicitly only where the caller can already legitimately see the canyon.
 */
export function requireCanyonOwner(
  userId: string,
  canyon: { ownerId: string },
  denial: AppError = new AppError(404, "Canyon not found"),
): void {
  if (canyon.ownerId !== userId) throw denial;
}

/**
 * Which of these canyon ids the user OWNS — the batch form of `getCanyonRole`'s
 * owner arm, for the bulk-share endpoint.
 *
 * Here rather than in the caller because "what makes someone the owner of a
 * canyon" is this file's answer and must stay this file's answer (SEC-001).
 * Ownership is deliberately the ONLY arm batched: a sharee may not re-share, so
 * the bulk path never needs the "shared" role, and a helper that returned it
 * would invite a caller to accept it.
 *
 * Ids that do not exist are simply absent from the result — a caller must
 * render that as the same outcome a foreign id gets, never as a distinct one
 * (the 404-not-403 rule, in aggregate form).
 */
export async function filterOwnedCanyonIds(
  userId: string,
  canyonIds: string[],
): Promise<Set<string>> {
  if (canyonIds.length === 0) return new Set();
  const owned = await prisma.canyon.findMany({
    where: { id: { in: canyonIds }, ownerId: userId },
    select: { id: true },
  });
  return new Set(owned.map((row) => row.id));
}
