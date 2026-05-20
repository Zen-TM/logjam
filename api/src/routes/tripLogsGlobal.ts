import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";

const router = Router();

// ── GET /trips ────────────────────────────────────────────────
// Returns all trip logs owned by the current user across all canyons
// Query params: ?search= (canyon name), ?dateFrom=, ?dateTo=
router.get(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await prisma.user.findUnique({
      where: { cognitoId: req.user!.sub },
    });
    if (!user) throw new AppError(404, "User not found");

    const { search, dateFrom, dateTo } = req.query as {
      search?: string;
      dateFrom?: string;
      dateTo?: string;
    };

    const trips = await prisma.tripLog.findMany({
      where: {
        userId: user.id,
        ...(search
          ? { canyon: { name: { contains: search, mode: "insensitive" } } }
          : {}),
        ...(dateFrom || dateTo
          ? {
              date: {
                ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
                ...(dateTo ? { lte: new Date(dateTo) } : {}),
              },
            }
          : {}),
      },
      orderBy: { date: "desc" },
      take: 500,
      include: {
        canyon: { select: { id: true, name: true } },
      },
    });

    res.json(trips);
  },
);

export default router;
