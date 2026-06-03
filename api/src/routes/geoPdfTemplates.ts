import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import { getParam } from "../lib/getParam";
import { resolveUser as getUser } from "../lib/resolveUser";
import { validateGeoPdfConfig } from "@logjam/shared";

const router = Router();

// GET / — list all templates for current user
router.get(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await getUser(req.user!.sub);
    const templates = await prisma.geoPdfTemplate.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
    });
    res.json(templates);
  },
);

// GET /:id — get single template (owner only)
router.get(
  "/:id",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await getUser(req.user!.sub);
    const id = getParam(req.params.id);
    const template = await prisma.geoPdfTemplate.findUnique({ where: { id } });
    if (!template || template.userId !== user.id) {
      throw new AppError(404, "Template not found");
    }
    res.json(template);
  },
);

// POST / — create template
router.post(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await getUser(req.user!.sub);
    const { name, config } = req.body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      throw new AppError(400, "name is required");
    }
    if (!config || typeof config !== "object") {
      throw new AppError(400, "config is required and must be an object");
    }
    const configError = validateGeoPdfConfig(config);
    if (configError) {
      throw new AppError(400, configError);
    }

    const template = await prisma.geoPdfTemplate.create({
      data: {
        userId: user.id,
        name: name.trim(),
        config,
      },
    });
    res.status(201).json(template);
  },
);

// PATCH /:id — update template (owner only)
router.patch(
  "/:id",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await getUser(req.user!.sub);
    const id = getParam(req.params.id);
    const existing = await prisma.geoPdfTemplate.findUnique({ where: { id } });
    if (!existing || existing.userId !== user.id) {
      throw new AppError(404, "Template not found");
    }

    const { name, config } = req.body;
    const data: { name?: string; config?: object } = {};
    if (name !== undefined) {
      if (typeof name !== "string" || name.trim().length === 0) {
        throw new AppError(400, "name must be a non-empty string");
      }
      data.name = name.trim();
    }
    if (config !== undefined) {
      if (typeof config !== "object") {
        throw new AppError(400, "config must be an object");
      }
      const configError = validateGeoPdfConfig(config);
      if (configError) {
        throw new AppError(400, configError);
      }
      data.config = config;
    }

    const template = await prisma.geoPdfTemplate.update({
      where: { id },
      data,
    });
    res.json(template);
  },
);

// DELETE /:id — delete template (owner only)
router.delete(
  "/:id",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await getUser(req.user!.sub);
    const id = getParam(req.params.id);
    const existing = await prisma.geoPdfTemplate.findUnique({ where: { id } });
    if (!existing || existing.userId !== user.id) {
      throw new AppError(404, "Template not found");
    }

    await prisma.geoPdfTemplate.delete({ where: { id } });
    res.status(204).end();
  },
);

export default router;
