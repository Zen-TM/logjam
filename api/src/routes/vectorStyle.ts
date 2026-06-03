import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import {
  VECTOR_STYLE_DEFAULTS,
  validateVectorStyleSettings,
} from "@logjam/shared";
import { resolveUser as getUser } from "../lib/resolveUser";

const router = Router();

// GET / — current user's active vector style. Returns defaults if the column
// is null (new users created before the migration ran, or test fixtures).
router.get(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await getUser(req.user!.sub);
    res.json(user.vectorStyle ?? VECTOR_STYLE_DEFAULTS);
  },
);

// PUT / — replace the entire vector style. Partial updates are not supported;
// the frontend always sends the full object after editing one field.
router.put(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await getUser(req.user!.sub);
    const validation = validateVectorStyleSettings(req.body);
    if (!validation.ok) {
      throw new AppError(400, `Invalid vector style: ${validation.errors.join("; ")}`);
    }
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { vectorStyle: validation.value as object },
      select: { vectorStyle: true },
    });
    res.json(updated.vectorStyle);
  },
);

export default router;
