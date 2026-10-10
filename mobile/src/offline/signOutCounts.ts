// What this phone holds that a sign-out would take and the account does not
// have: the counts behind the confirmation (`signOutConfirm.ts`). The kinds are
// `wipedStores.ts`'s; this reads each from its own store.
//
// Reads only. Nothing here is sent anywhere, logged, or kept.
import { groupArtifacts, overlayJobId, regionGroupKey } from "./artifactGroups";
import { listArtifacts } from "./registryDb";
import { listGeoPdfImports } from "../geopdf/geoPdfImportsDb";
import { readRouteDraft } from "../map/routeDraftStore";
import { countUnsyncedChanges, getSyncDb } from "../sync/syncDb";
import { listTracks } from "../tracks/tracksDb";
import type { SignOutCounts } from "./signOutConfirm";

/** Edits a conflict set aside for the user to settle, which only sign-out drops. */
async function countShelvedEdits(): Promise<number> {
  const db = await getSyncDb();
  const row = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM conflict_shelf",
  );
  return row?.n ?? 0;
}

export async function countSignOutLosses(): Promise<SignOutCounts> {
  const [unsynced, unresolved, artifacts, geoPdfs, tracks, draft] =
    await Promise.all([
      countUnsyncedChanges(),
      countShelvedEdits(),
      listArtifacts(),
      listGeoPdfImports(),
      listTracks(),
      readRouteDraft(),
    ]);
  const regionFiles = artifacts.filter(
    (artifact) =>
      artifact.kind === "basemap-region" || artifact.kind === "dem-region",
  );
  return {
    unsynced,
    unresolved,
    // A recording with points and no account copy: one that has a backup is a
    // file in the account, and comes back as "recorded elsewhere".
    recordings: tracks.filter(
      (track) => track.mediaId === null && track.pointCount > 0,
    ).length,
    routeDraft: draft ? 1 : 0,
    // One card per area saved, as Saved shows them, not one per file.
    regions: groupArtifacts(
      artifacts.filter((artifact) => artifact.kind === "basemap-region"),
      regionGroupKey,
    ).length,
    regionBytes: regionFiles.reduce((sum, file) => sum + file.sizeBytes, 0),
    geoPdfs: geoPdfs.length,
    topos: groupArtifacts(
      artifacts.filter((artifact) => artifact.kind === "topo-overlay"),
      overlayJobId,
    ).length,
  };
}
