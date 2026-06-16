import { Router, Response } from "express";
import { requireAuth, AuthenticatedRequest } from "../middleware/auth";
import prisma from "../services/prisma";
import { AppError } from "../middleware/errorHandler";
import { getParam } from "../lib/getParam";
import { resolveUser as getUser } from "../lib/resolveUser";
import {
  RASTER_TEMPLATE_DEFAULTS,
  AUTO_EXPORT_DEFAULTS,
  validateRasterTemplateSettings,
  validateAutoExportSettings,
} from "@logjam/shared";

const router = Router();

const DEFAULT_TEMPLATE_ID = "default";

// The "Default" preset is synthetic: it is not persisted as a per-user row.
// The route surfaces it as a virtual, read-only template at the top of the
// list, sharing the same shape as user-saved rows so the frontend can treat
// it uniformly.
function defaultTemplate() {
  return {
    id: DEFAULT_TEMPLATE_ID,
    userId: null,
    name: "Default",
    isSystem: true,
    config: RASTER_TEMPLATE_DEFAULTS,
    autoExport: AUTO_EXPORT_DEFAULTS,
    createdAt: null,
    updatedAt: null,
  };
}

// GET / — list user templates with the synthetic Default at the top.
router.get(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await getUser(req.user!.sub);
    const templates = await prisma.topoTemplate.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
    });
    const enriched = templates.map((t) => ({ ...t, isSystem: false }));
    res.json([defaultTemplate(), ...enriched]);
  },
);

// GET /:id — single template (owner only, or "default").
router.get(
  "/:id",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const id = getParam(req.params.id);
    if (id === DEFAULT_TEMPLATE_ID) {
      res.json(defaultTemplate());
      return;
    }
    const user = await getUser(req.user!.sub);
    const template = await prisma.topoTemplate.findUnique({ where: { id } });
    if (!template || template.userId !== user.id) {
      throw new AppError(404, "Template not found");
    }
    res.json({ ...template, isSystem: false });
  },
);

// POST / — create user template.
router.post(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const user = await getUser(req.user!.sub);
    const { name, config, autoExport } = req.body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      throw new AppError(400, "name is required");
    }
    const validation = validateRasterTemplateSettings(config);
    if (!validation.ok) {
      throw new AppError(400, `Invalid topo settings: ${validation.errors.join("; ")}`);
    }

    let autoExportConfig: object | undefined;
    if (autoExport !== undefined && autoExport !== null) {
      const v = validateAutoExportSettings(autoExport);
      if (!v.ok) {
        throw new AppError(400, `Invalid auto-export settings: ${v.errors.join("; ")}`);
      }
      autoExportConfig = v.value as object;
    }

    const template = await prisma.topoTemplate.create({
      data: {
        userId: user.id,
        name: name.trim(),
        config: validation.value as object,
        autoExport: autoExportConfig ?? undefined,
      },
    });
    res.status(201).json({ ...template, isSystem: false });
  },
);

// PATCH /:id — update user template; the synthetic Default is read-only.
router.patch(
  "/:id",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const id = getParam(req.params.id);
    if (id === DEFAULT_TEMPLATE_ID) {
      throw new AppError(400, "The Default template is read-only");
    }
    const user = await getUser(req.user!.sub);
    const existing = await prisma.topoTemplate.findUnique({ where: { id } });
    if (!existing || existing.userId !== user.id) {
      throw new AppError(404, "Template not found");
    }

    const { name, config, autoExport } = req.body;
    const data: { name?: string; config?: object; autoExport?: object } = {};
    if (name !== undefined) {
      if (typeof name !== "string" || name.trim().length === 0) {
        throw new AppError(400, "name must be a non-empty string");
      }
      data.name = name.trim();
    }
    if (config !== undefined) {
      const validation = validateRasterTemplateSettings(config);
      if (!validation.ok) {
        throw new AppError(400, `Invalid topo settings: ${validation.errors.join("; ")}`);
      }
      data.config = validation.value as object;
    }
    if (autoExport !== undefined && autoExport !== null) {
      const v = validateAutoExportSettings(autoExport);
      if (!v.ok) {
        throw new AppError(400, `Invalid auto-export settings: ${v.errors.join("; ")}`);
      }
      data.autoExport = v.value as object;
    }

    const template = await prisma.topoTemplate.update({ where: { id }, data });
    res.json({ ...template, isSystem: false });
  },
);

// DELETE /:id — owner only; Default cannot be deleted.
router.delete(
  "/:id",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const id = getParam(req.params.id);
    if (id === DEFAULT_TEMPLATE_ID) {
      throw new AppError(400, "The Default template cannot be deleted");
    }
    const user = await getUser(req.user!.sub);
    const existing = await prisma.topoTemplate.findUnique({ where: { id } });
    if (!existing || existing.userId !== user.id) {
      throw new AppError(404, "Template not found");
    }
    await prisma.topoTemplate.delete({ where: { id } });
    res.status(204).end();
  },
);

export default router;
