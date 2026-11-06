// "Update" on a saved area: download the same area again, at the same detail
// and with the same maps, into the same card. Each old file is deleted only
// when its new one is whole (`supersededBy`, run by the queue), so a failed or
// stopped update leaves the card as it was.
//
// A sharpened area's clips are not re-cut: their download links come from the
// account's list, which this does not ask for, and they stay as saved.
//
// PRIVACY: the bbox is read back from the card's own files and goes where a
// first save sends it: byte ranges to the CDN, never to Logjam's API.
import { randomUUID } from "expo-crypto";
import NetInfo from "@react-native-community/netinfo";
import {
  NSW_CONTOURS,
  NSW_FIRE,
  NSW_LAND,
  NSW_SLOPE,
  SHARPENED_SOURCE_PREFIX,
  type RegionBbox,
} from "@logjam/shared";

import type { MapArtifact } from "../map/sourceResolver";
import { askAllowCellular } from "./askMobileData";
import { NotEnoughSpaceError, assertSpaceFor } from "./freeSpace";
import {
  enqueueRegionDownloads,
  type RegionTaskSpec,
} from "./regionDownloadQueue";
import { regionGroupKey } from "./artifactGroups";
import type { RegionJobSpec } from "./regionTileDownload";

const ownFiles = (members: readonly MapArtifact[]) =>
  members.filter((a) => !a.logicalKey.startsWith(SHARPENED_SOURCE_PREFIX));

/**
 * The jobs that download a card's own files again, or null when the card holds
 * nothing to read an area from (a legacy row with no extent, or only a
 * sharpened area's clips). The card offers Update only when this is not null.
 * Guard: `regionUpdate.test.ts`.
 */
export function regionUpdateSpecs(
  members: readonly MapArtifact[],
  groupLabel: string,
  allowCellular: boolean,
  newId: () => string,
): RegionTaskSpec[] | null {
  const files = ownFiles(members);
  const box = files.find((a) => a.bbox)?.bbox;
  if (!box || files.length === 0) return null;
  const bbox: RegionBbox = {
    west: box[0],
    south: box[1],
    east: box[2],
    north: box[3],
  };
  const groupId = regionGroupKey(files[0]);
  const run = { bbox, groupId, groupLabel, allowCellular };
  return files.map((a): RegionTaskSpec => {
    const base = {
      id: newId(),
      label: a.label ?? groupLabel,
      update: true as const,
      ...run,
    };
    if (a.format === "mbtiles") {
      return {
        taskKind: "tile-pyramid",
        ...base,
        basemapId: a.logicalKey as RegionJobSpec["basemapId"],
        zMin: a.minzoom ?? undefined,
        zMax: a.maxzoom ?? 0,
      };
    }
    return {
      taskKind: "clip",
      ...base,
      basemapId: a.logicalKey,
      ...(a.kind === "dem-region" ? { demSourceId: a.logicalKey } : {}),
      ...(a.logicalKey === NSW_CONTOURS.id ? { contours: true } : {}),
      ...(a.logicalKey === NSW_SLOPE.id ? { slope: true } : {}),
      ...(a.logicalKey === NSW_LAND.id ? { land: true } : {}),
      ...(a.logicalKey === NSW_FIRE.id ? { fire: true } : {}),
    };
  });
}

export const canUpdateRegion = (members: readonly MapArtifact[]) =>
  regionUpdateSpecs(members, "", false, () => "") !== null;

/**
 * Ask what an update needs the user to decide, then queue it. Resolves to why
 * it was not queued when the caller should say so (offline, no room), or null
 * when it was queued, there was nothing to update or the user said no.
 */
export async function startRegionUpdate(
  members: readonly MapArtifact[],
  groupLabel: string,
): Promise<string | null> {
  // Before any question: a card with nothing to update would answer them all
  // and then do nothing.
  const specs = regionUpdateSpecs(members, groupLabel, false, randomUUID);
  if (!specs) return null;
  const state = await NetInfo.fetch();
  if (state.isConnected === false) {
    return "Updating a map needs a connection. Try again when you have one.";
  }
  const allowCellular = await askAllowCellular();
  if (allowCellular === null) return null;
  try {
    // The new copy is whole beside the old one before the old one goes.
    await assertSpaceFor(
      ownFiles(members).reduce((sum, a) => sum + a.sizeBytes, 0),
    );
  } catch (err) {
    if (!(err instanceof NotEnoughSpaceError)) throw err;
    return `Not enough space. ${err.message}`;
  }
  enqueueRegionDownloads(specs.map((spec) => ({ ...spec, allowCellular })));
  return null;
}
