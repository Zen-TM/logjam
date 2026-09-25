import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import { resolveUser } from "../lib/resolveUser";

// Device push-token registry (Stage 3 mobile). Tokens are Expo push tokens —
// opaque, client-generated, not secrets, but bound to the signed-in user so
// fan-out targets only that user's devices.
const router = Router();

const TOKEN_MAX_LENGTH = 512;
const VALID_PLATFORMS = new Set(["ios", "android"]);

// POST /devices — register (or re-bind) this device's push token. Upsert by
// token: a token re-registered by a different signed-in user moves to them
// (same physical device, new login) rather than duplicating or leaking pushes
// to the previous account.
router.post("/", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const user = await resolveUser(req.user!.sub);
  const { token, platform } = req.body as { token?: unknown; platform?: unknown };
  if (
    typeof token !== "string" ||
    token.length === 0 ||
    token.length > TOKEN_MAX_LENGTH
  ) {
    throw new AppError(400, "Invalid token");
  }
  if (typeof platform !== "string" || !VALID_PLATFORMS.has(platform)) {
    throw new AppError(400, "Invalid platform");
  }

  const device = await prisma.deviceToken.upsert({
    where: { token },
    create: { userId: user.id, token, platform },
    update: { userId: user.id, platform, lastSeenAt: new Date() },
  });
  res.status(201).json({ id: device.id });
});

// DELETE /devices/:token — unregister on sign-out. Idempotent: deleting a
// token that isn't registered (or isn't yours) is a 204 either way, so the
// endpoint can't confirm whether some other user holds a given token.
router.delete(
  "/:token",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await resolveUser(req.user!.sub);
    const token = req.params.token;
    if (typeof token !== "string") throw new AppError(400, "Invalid token");
    await prisma.deviceToken.deleteMany({
      where: { token, userId: user.id },
    });
    res.status(204).send();
  },
);

export default router;
