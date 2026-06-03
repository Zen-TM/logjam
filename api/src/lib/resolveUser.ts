import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";

/**
 * Resolve a Cognito subject (`req.user!.sub`, set by requireAuth after the JWT
 * is verified) to the internal User row, throwing 404 if no row exists yet.
 *
 * This is the single canonical implementation of the cognitoId→user lookup that
 * every authenticated route needs (ARCH-008). Routes that previously declared
 * their own identical `getUser`/`loadUser` helper import this instead.
 *
 * Note: GET /users/me deliberately does NOT use this — it has bespoke
 * first-request create / Cognito-rebind logic and must not 404 on a missing row.
 */
export async function resolveUser(cognitoSub: string) {
  const user = await prisma.user.findUnique({ where: { cognitoId: cognitoSub } });
  if (!user) throw new AppError(404, "User not found");
  return user;
}
