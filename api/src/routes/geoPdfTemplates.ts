import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { AppError, malformed } from "../middleware/errorHandler";
import { getParam } from "../lib/getParam";
import { resolveUser as getUser } from "../lib/resolveUser";
import { say, validateGeoPdfTemplateConfig } from "@logjam/shared";

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
      throw new AppError(404, say`Couldn't find that template.`);
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
      throw new AppError(400, say`A template needs a name.`);
    }
    if (!config || typeof config !== "object") {
      throw malformed("config is required and must be an object");
    }
    const configError = validateGeoPdfTemplateConfig(config);
    if (configError) {
      throw malformed(configError);
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
      throw new AppError(404, say`Couldn't find that template.`);
    }

    const { name, config } = req.body;
    const data: { name?: string; config?: object } = {};
    if (name !== undefined) {
      if (typeof name !== "string" || name.trim().length === 0) {
        throw new AppError(400, say`A template needs a name.`);
      }
      data.name = name.trim();
    }
    if (config !== undefined) {
      if (typeof config !== "object") {
        throw malformed("config must be an object");
      }
      const configError = validateGeoPdfTemplateConfig(config);
      if (configError) {
        throw malformed(configError);
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
      throw new AppError(404, say`Couldn't find that template.`);
    }

    await prisma.geoPdfTemplate.delete({ where: { id } });
    res.status(204).end();
  },
);

export default router;
