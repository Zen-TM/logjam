// One CARD per thing the user saved, not one per file we wrote.
//
// A "Save an offline map" run downloads a basemap per selected source and a
// generated LiDAR topo job lands as one artifact per layer — five of them.
// Grouping keeps related rows together so an area or job is managed as one card.
//
// The grouping key differs per kind (a region's `groupId`, an overlay's jobId
// inside its `logicalKey`) but the aggregation — total size, union extent,
// which name to show — is the same, so it lives here as pure functions with a
// test beside them.
//
// PRIVACY: `unionBbox` computes an extent used only to move the camera. It is
// never rendered and never logged. Guard: mobile/src/sentry/scrubEvent.test.ts.
import type { MapArtifact } from "../map/sourceResolver";

/**
 * What a saved area is made of: every kind its run files, the clips and the
 * tile pyramids. Saved groups them into the area's card and sign-out counts
 * them as the area's bytes. Guard: `artifactGroups.test.ts`
 * ("REGION_ARTIFACT_KINDS").
 */
export const REGION_ARTIFACT_KINDS: readonly MapArtifact["kind"][] = [
  "basemap-region",
  "dem-region",
  "contours-region",
  "slope-region",
  "land-region",
];

export function isRegionArtifact(artifact: Pick<MapArtifact, "kind">): boolean {
  return REGION_ARTIFACT_KINDS.includes(artifact.kind);
}

/**
 * Whether a file of a saved area came without the user picking it: the vector
 * map, the elevation, contours, slope and land clips and a sharpened area's
 * clips. The user picked only the raster maps, so only those can go on their
 * own; deleting any other leaves an area that quietly loses a tool offline.
 * Guard: `artifactGroups.test.ts` ("isBundledRegionMember").
 */
export function isBundledRegionMember(
  artifact: Pick<MapArtifact, "kind" | "logicalKey">,
): boolean {
  return (
    artifact.kind !== "basemap-region" || artifact.logicalKey === "protomaps"
  );
}

/**
 * The files of a saved area that `fresh` replaces: a group holds one file per
 * kind and source, so a newer download of the same map in the same card (an
 * update) takes the older one's place. Nothing else is touched.
 * Guard: `artifactGroups.test.ts` ("supersededBy").
 */
export function supersededBy(
  fresh: MapArtifact,
  all: readonly MapArtifact[],
): MapArtifact[] {
  const key = regionGroupKey(fresh);
  return all.filter(
    (other) =>
      other.id !== fresh.id &&
      isRegionArtifact(other) &&
      regionGroupKey(other) === key &&
      other.kind === fresh.kind &&
      other.logicalKey === fresh.logicalKey,
  );
}

/**
 * What an update does when a download lands. It swaps in the new file only
 * when it is no worse than the one it replaces: a first save accepts a few
 * dead tiles (the user has nothing else), an update does not trade a whole
 * copy for one with holes. An accepted file takes over the older one's
 * first-saved time, so the card keeps its place (`cardDates`).
 * Guard: `artifactGroups.test.ts` ("settleUpdate").
 */
export function settleUpdate(
  fresh: MapArtifact,
  failedTiles: number,
  all: readonly MapArtifact[],
): { accepted: boolean; drop: MapArtifact[]; firstSavedAt: string | null } {
  const older = supersededBy(fresh, all);
  if (older.length === 0) {
    return { accepted: true, drop: [], firstSavedAt: null };
  }
  if (failedTiles > 0) {
    return { accepted: false, drop: [fresh], firstSavedAt: null };
  }
  const first = older
    .map((a) => a.firstSavedAt ?? a.downloadedAt)
    .reduce((a, b) => (a < b ? a : b));
  return { accepted: true, drop: older, firstSavedAt: first };
}

/**
 * When a card was first saved (its place in Saved, oldest file wins) and, when
 * an update has replaced any of its files, when it was last updated.
 * Guard: `artifactGroups.test.ts` ("cardDates").
 */
export function cardDates(members: readonly MapArtifact[]): {
  savedAt: string;
  updatedAt: string | null;
} {
  const times = members.map((a) => a.firstSavedAt ?? a.downloadedAt);
  const newest = members.reduce(
    (latest, a) => (a.downloadedAt > latest ? a.downloadedAt : latest),
    "",
  );
  return {
    savedAt: times.reduce((a, b) => (a < b ? a : b)),
    updatedAt: members.some((a) => a.firstSavedAt) ? newest : null,
  };
}

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
      group.label =
        group.label ?? artifact.groupLabel ?? artifact.label ?? null;
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
