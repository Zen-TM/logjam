// The account's completed-overlays list, with the epoch it was asked in, so a
// list in flight when a sign-out wipe runs is never served or kept
// (sharpenedArchives.ts `inAreasEpoch`). The map and the save screen both
// read it.
import { apiFetch } from "../api/apiFetch";
import { inAreasEpoch } from "./sharpenedArchives";
import type { CompletedOverlaysResponse } from "./topoOverlays";

export function getCompletedOverlays() {
  return inAreasEpoch(() =>
    apiFetch<CompletedOverlaysResponse>("/topo-jobs/completed-overlays"),
  );
}
