import { Router, Response } from "express";
import { Prisma } from "@prisma/client";
import {
  isThemeSchemeId,
  normalizeUserUiPreferences,
  isTripLogCustomFieldDef,
} from "@logjam/shared";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import { verifyEmail } from "../services/email";

const router = Router();

function serializeUserForResponse(
  user: {
    storageUsedBytes: bigint;
    storageQuotaBytes: bigint;
    uiPreferences: Prisma.JsonValue;
  } & Record<string, unknown>,
) {
  return {
    ...user,
    storageUsedBytes: Number(user.storageUsedBytes),
    storageQuotaBytes: Number(user.storageQuotaBytes),
    uiPreferences: normalizeUserUiPreferences(user.uiPreferences),
  };
}

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

    // First time this user has hit the API — create their DB record.
    // Prefer preferred_username from Cognito; fall back to email prefix rather
    // than raw cognito:username which can be an auto-generated UUID.
    const isUUID = (s: string) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
    const initialUsername =
      username && !isUUID(username) ? username : email.split("@")[0];

    if (!user) {
      try {
        user = await prisma.user.create({
          data: {
            cognitoId: sub,
            email,
            username: initialUsername,
          },
        });
        // Trigger SES sandbox verification so we can email this user
        verifyEmail(email).catch(() => {});
      } catch (e) {
        // Race condition: a concurrent request already created the user record.
        // Recover by fetching the record that was just created.
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === "P2002"
        ) {
          const existing = await prisma.user.findUnique({
            where: { cognitoId: sub },
          });
          if (!existing) throw e;
          user = existing;
        } else {
          throw e;
        }
      }
    } else if (user.email !== email) {
      // Only sync email from Cognito — username is managed by the user via PATCH /users/me
      user = await prisma.user.update({
        where: { id: user.id },
        data: { email },
      });
      verifyEmail(email).catch(() => {});
    }

    res.json(serializeUserForResponse(user));
  },
);

// PATCH /users/me — update current user's profile
router.patch(
  "/me",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const { sub } = req.user!;
    const { username, themeSchemeId, tripLogCustomFields } = req.body as {
      username?: unknown;
      themeSchemeId?: unknown;
      tripLogCustomFields?: unknown;
    };

    const user = await prisma.user.findUnique({ where: { cognitoId: sub } });
    if (!user) throw new AppError(404, "User not found");

    const updates: {
      username?: string;
      uiPreferences?: Prisma.InputJsonValue;
    } = {};

    if (username !== undefined) {
      if (typeof username !== "string" || username.trim().length === 0) {
        throw new AppError(400, "username must be a non-empty string");
      }
      updates.username = username;
    }

    if (themeSchemeId !== undefined || tripLogCustomFields !== undefined) {
      if (themeSchemeId !== undefined && !isThemeSchemeId(themeSchemeId)) {
        throw new AppError(400, "Invalid themeSchemeId");
      }
      if (tripLogCustomFields !== undefined) {
        if (
          !Array.isArray(tripLogCustomFields) ||
          !tripLogCustomFields.every(isTripLogCustomFieldDef)
        ) {
          throw new AppError(400, "Invalid tripLogCustomFields");
        }
      }

      const current = normalizeUserUiPreferences(user.uiPreferences);
      updates.uiPreferences = {
        ...current,
        ...(themeSchemeId !== undefined ? { themeSchemeId } : {}),
        ...(tripLogCustomFields !== undefined ? { tripLogCustomFields } : {}),
      };
    }

    if (Object.keys(updates).length === 0) {
      throw new AppError(400, "No valid update fields provided");
    }

    const updated = await prisma.user.update({
      where: { cognitoId: sub },
      data: updates,
    });

    res.json(serializeUserForResponse(updated));
  },
);

export default router;
