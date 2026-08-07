// Draft safety: the in-progress route survives the app being killed.
//
// Drawing a route is minutes of work with no save point until the end, and
// Android kills backgrounded apps freely — a phone in a pocket between two
// abseils is exactly the case. So every change to the draft is written here,
// and the map restores it on the next launch.
//
// Stored as points + anchor indices rather than the draft structure, because
// that is what `draftFromRoute` already reconstructs a draft from and what a
// saved route already stores. One representation, not a second one to keep in
// step.
//
// PRIVACY: these are coordinates through a canyon. They live in
// logjam-offline.db (app-private, backup-excluded) and are cleared by
// wipeLocalData on any account transition. Nothing here logs.
import type { RoutePoint } from "@logjam/shared";

import { getOfflineDb } from "../offline/registryDb";

export type StoredRouteDraft = {
  points: RoutePoint[];
  anchors: number[];
  /** Set when the draft is an EDIT of a saved route, so Save updates it. */
  editingRouteId: string | null;
};

export async function readRouteDraft(): Promise<StoredRouteDraft | null> {
  const db = await getOfflineDb();
  const row = await db.getFirstAsync<{
    pointsJson: string;
    anchorsJson: string;
    editingRouteId: string | null;
  }>("SELECT pointsJson, anchorsJson, editingRouteId FROM route_draft WHERE id = 1");
  if (!row) return null;
  try {
    const points = JSON.parse(row.pointsJson) as RoutePoint[];
    const anchors = JSON.parse(row.anchorsJson) as number[];
    if (points.length === 0) return null;
    return { points, anchors, editingRouteId: row.editingRouteId };
  } catch {
    // Unparseable = nothing to restore. Dropping a corrupt draft is better
    // than refusing to open the map over it.
    return null;
  }
}

export async function saveRouteDraft(draft: StoredRouteDraft): Promise<void> {
  const db = await getOfflineDb();
  await db.runAsync(
    `INSERT INTO route_draft (id, pointsJson, anchorsJson, editingRouteId, savedAt)
     VALUES (1, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       pointsJson = excluded.pointsJson,
       anchorsJson = excluded.anchorsJson,
       editingRouteId = excluded.editingRouteId,
       savedAt = excluded.savedAt`,
    JSON.stringify(draft.points),
    JSON.stringify(draft.anchors),
    draft.editingRouteId,
    new Date().toISOString(),
  );
}

export async function clearRouteDraft(): Promise<void> {
  const db = await getOfflineDb();
  await db.runAsync("DELETE FROM route_draft");
}
