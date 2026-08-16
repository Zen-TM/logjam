// One CARD per thing the user saved, not one per file we wrote.
//
// A "Save maps offline" run downloads a basemap per selected source and a
// generated LiDAR topo job lands as one artifact per layer — five of them. Both
// used to arrive in Saved as unrelated rows, so deleting "the region" meant
// finding and deleting three cards and hoping you had them all.
//
// The grouping key differs per kind (a region's `groupId`, an overlay's jobId
// inside its `logicalKey`) but the aggregation — total size, union extent,
// which name to show — is the same, so it lives here as pure functions with a
// test beside them.
//
// PRIVACY: `unionBbox` computes an extent used only to move the camera. It is
// never rendered and never logged (DESIGN.md §11).
import type { MapArtifact } from "../map/sourceResolver";

export type Bbox = [west: number, south: number, east: number, north: number];

export type ArtifactGroup = {
  /** Stable identity for the card — the group key, not a member id. */
  key: string;
  /** The user's own name for the group, if any of its rows carry one. */
  label: string | null;
  sizeBytes: number;
  bbox: Bbox | null;
  members: MapArtifact[];
};

/**
 * Which card an artifact belongs to.
 *
 * This is what makes a RESUME land back in the run it came from: the resumed
 * job carries the original `groupId` (from its queue spec, or recovered from
 * the region file's metadata), so the map it finally saves joins the maps its
 * siblings already saved instead of opening a second card with the same name.
 *
 * Legacy rows predate grouping and stand alone under their own id.
 */
export function regionGroupKey(artifact: MapArtifact): string {
  return artifact.groupId ?? artifact.id;
}

/** A topo overlay's `logicalKey` is `<jobId>/<layer>`; the job is the card. */
export function overlayJobId(artifact: MapArtifact): string {
  const slash = artifact.logicalKey.indexOf("/");
  return slash < 0 ? artifact.logicalKey : artifact.logicalKey.slice(0, slash);
}

export function unionBbox(boxes: (Bbox | null | undefined)[]): Bbox | null {
  let union: Bbox | null = null;
  for (const box of boxes) {
    if (!box) continue;
    union = union
      ? [
          Math.min(union[0], box[0]),
          Math.min(union[1], box[1]),
          Math.max(union[2], box[2]),
          Math.max(union[3], box[3]),
        ]
      : [...box];
  }
  return union;
}

/**
 * Group artifacts into cards, preserving the order they arrived in (the
 * registry lists newest first, and a card appears where its first row would
 * have). `groupLabel` wins over a per-row `label`: the group name is what the
 * user typed for the whole area, a row label is a rename of one file.
 */
export function groupArtifacts(
  artifacts: MapArtifact[],
  keyOf: (artifact: MapArtifact) => string,
): ArtifactGroup[] {
  const groups = new Map<string, ArtifactGroup>();
  for (const artifact of artifacts) {
    const key = keyOf(artifact);
    const group = groups.get(key);
    if (group) {
      group.members.push(artifact);
      group.sizeBytes += artifact.sizeBytes;
      group.label = group.label ?? artifact.groupLabel ?? artifact.label ?? null;
      group.bbox = unionBbox([group.bbox, artifact.bbox]);
    } else {
      groups.set(key, {
        key,
        label: artifact.groupLabel ?? artifact.label ?? null,
        sizeBytes: artifact.sizeBytes,
        bbox: artifact.bbox ? [...artifact.bbox] : null,
        members: [artifact],
      });
    }
  }
  return [...groups.values()];
}
