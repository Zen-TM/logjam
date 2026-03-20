import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";

const router = Router();

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

    // First time this user has hit the API — create their DB record
    if (!user) {
      user = await prisma.user.create({
        data: {
          cognitoId: sub,
          email,
          username,
        },
      });
    }

    res.json(user);
  },
);

// PATCH /users/me — update current user's profile
router.patch(
  "/me",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const { sub } = req.user!;
    const { username } = req.body;

    const user = await prisma.user.findUnique({ where: { cognitoId: sub } });
    if (!user) throw new AppError(404, "User not found");

    const updated = await prisma.user.update({
      where: { cognitoId: sub },
      data: { username },
    });

    res.json(updated);
  },
);

export default router;
