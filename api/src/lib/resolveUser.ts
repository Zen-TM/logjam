import { say } from "@logjam/shared";
import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";

/**
 * Resolve the token's subject (`req.user!.sub`, set by requireAuth after the
 * JWT is verified) to the internal User row, throwing 404 if no row exists yet.
 *
 * This is the single canonical implementation of the subject→user lookup that
 * every authenticated route needs.
 *
 * Note: GET /users/me deliberately does NOT use this — it has bespoke
 * first-request create / rebind logic and must not 404 on a missing row.
 */
export async function resolveUser(sub: string) {
  const user = await prisma.user.findUnique({
    where: { subject: sub },
  });
  if (!user)
    throw new AppError(
      404,
      say`Couldn't find your account. Sign out, then sign in again.`,
    );
  return user;
}
