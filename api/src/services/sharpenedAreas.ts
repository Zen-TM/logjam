// The sharpened areas a user may read: their own completed sharpened jobs and
// those shared with them directly, the rule /topo-jobs/completed-overlays
// applies. docs/decisions/0040-a-sharpened-area-is-a-private-dem-source.md
//
// PRIVACY: an area's tile range and coverage say where its owner surveyed.
// Nothing here logs them. Its archive keys reach a client only inside
// presigned URLs, never as fields of their own (src/__tests__/sharpenedAreas.test.ts).
import { Prisma } from "@prisma/client";
import type { SharpenedArea } from "@logjam/shared";
import prisma from "./prisma";
import { directlySharedIds } from "../lib/shareAccess";

export type VisibleSharpenedArea = SharpenedArea & {
  keys: { heights: string; slope: string; contours: string | null };
};

const isInt = (v: unknown): v is number => Number.isInteger(v);
const isNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

/**
 * An area from a completed job's `sharpen` column (topo/sharpen.py's result
 * plus the archive keys topo/worker.py adds), or null for a row that is not
 * one: a job still marked, or a result this build cannot read. Each key must lie
 * under the job's own outputs, so a bad row can never point the API's role
 * at another object. Guard: `sharpenedAreas.unit.test.ts`.
 */
export function sharpenedAreaFrom(row: {
  id: string;
  createdAt: Date;
  sharpen: unknown;
}): VisibleSharpenedArea | null {
  const r = row.sharpen as Record<string, unknown> | null;
  if (!r || typeof r !== "object" || r.v !== 1) return null;
  const { zmax, tiles15, coverage, credit } = r;
  const keys = r.keys as Record<string, unknown> | undefined;
  const own = (key: unknown): key is string =>
    typeof key === "string" && key.startsWith(`outputs/${row.id}/`);
  if (
    (zmax !== 16 && zmax !== 17) ||
    !Array.isArray(tiles15) ||
    tiles15.length !== 4 ||
    !tiles15.every(isInt) ||
    !Array.isArray(coverage) ||
    coverage.length !== 4 ||
    !coverage.every(isNum) ||
    typeof credit !== "string" ||
    !keys ||
    !own(keys.heights) ||
    !own(keys.slope) ||
    (keys.contours != null && !own(keys.contours))
  )
    return null;
  return {
    id: row.id,
    zmax,
    tiles15: tiles15 as [number, number, number, number],
    coverage: coverage as [number, number, number, number],
    contours: keys.contours != null,
    credit,
    createdAt: row.createdAt.toISOString(),
    keys: {
      heights: keys.heights,
      slope: keys.slope,
      contours: (keys.contours as string | undefined) ?? null,
    },
  };
}

export async function visibleSharpenedAreas(
  userId: string,
): Promise<VisibleSharpenedArea[]> {
  const rows = await prisma.topoJob.findMany({
    where: {
      status: "complete",
      sharpen: { not: Prisma.DbNull },
      OR: [
        { userId },
        { id: { in: await directlySharedIds(userId, "topoJob") } },
      ],
    },
    select: { id: true, createdAt: true, sharpen: true },
  });
  return rows
    .map(sharpenedAreaFrom)
    .filter((area): area is VisibleSharpenedArea => area != null);
}
