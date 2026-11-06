// The ways a trip can be given while it is being logged. Every ADD_WAY source
// but the pen ends the same way: a COPY of a file on the trip (the API links a
// trip's files, never a way), so the original is never touched and survives
// the trip. Each returns what `StagedWay.write` runs with the new trip's id,
// once the trip is queued; the file waits behind the trip's create in the
// outbox (`flush.ts`, `isLinkPending`).
//
// A recording copies with its media id (`attachRecordedTrack`), which is what
// makes it stop offering "Log a trip" afterwards.
//
// PRIVACY: a route's line is written to a scratch file and deleted; nothing
// here logs a name or a coordinate.
import * as FileSystem from "expo-file-system/legacy";
import { GPX_MIME_TYPE, routeToGpx } from "@logjam/shared";

import { routeFileMimeType } from "../media/routeFileMime";
import { scratchFileUri } from "../offline/localStores";
import type { VectorImport } from "../imports/importsDb";
import { vectorImportActions } from "../saved/assetActions";
import type { MirrorRoute } from "../sync/mirrorStore";
import { attachMediaLocal, type PickedFile } from "../sync/mediaUpload";
import { attachRecordedTrack } from "../tracks/attachRecordedTrack";
import type { StagedWay } from "../places/AddWaySheet";
import type { TripTrackSource } from "../tracks/tripTrackSource";
import type { Track } from "../tracks/tracksDb";

/** What a trip's copy of a way says once it is staged: nothing, the form says
 *  it with its own hint. */
const SAID = "";

export function tripFileWay(file: PickedFile) {
  return async (tripId: string): Promise<string> => {
    await attachMediaLocal("tripLog", tripId, file);
    return SAID;
  };
}

export function tripRecordingWay(track: Pick<Track, "id" | "name">) {
  return async (tripId: string): Promise<string> => {
    // Too few points to be a line: the list withholds these, so this is a
    // recording that changed under the form.
    if (!(await attachRecordedTrack("tripLog", tripId, track)))
      throw new Error("The recording has too few points.");
    return SAID;
  };
}

export function tripRouteWay(
  route: Pick<MirrorRoute, "id" | "name" | "points">,
) {
  return async (tripId: string): Promise<string> => {
    const scratch = await scratchFileUri(`${route.id}.gpx`);
    try {
      await FileSystem.writeAsStringAsync(
        scratch,
        routeToGpx(route.name, route.points),
      );
      await attachMediaLocal("tripLog", tripId, {
        uri: scratch,
        mimeType: GPX_MIME_TYPE,
        fileName: `${route.name}.gpx`,
      });
    } finally {
      await FileSystem.deleteAsync(scratch, { idempotent: true }).catch(
        console.error,
      );
    }
    return SAID;
  };
}

/** The import's ORIGINAL .gpx/.kml, or null where this phone has none or it is
 *  not a route file: a verb that can only refuse is absent (DESIGN.md). */
export function tripImportWay(row: VectorImport) {
  const copy = vectorImportActions(row).sendCopy;
  const mimeType = copy ? routeFileMimeType(copy.filename) : null;
  if (!copy || !mimeType) return null;
  return async (tripId: string): Promise<string> => {
    const { uri, cleanup } = await copy.resolveFile();
    try {
      await attachMediaLocal("tripLog", tripId, {
        uri,
        mimeType,
        fileName: copy.filename,
      });
    } finally {
      await cleanup?.();
    }
    return SAID;
  };
}

/** "Log a trip" on a track: the track arrives as the form's way, so it can be
 *  swapped or taken out, and still names its recording (`sourceMediaId`) when
 *  the trip is saved, which is what stops the track offering "Log a trip". */
export function trackSourceWay(source: TripTrackSource): StagedWay {
  return {
    label: source.name,
    write: async (tripId) => {
      if (!(await source.attach(tripId)))
        throw new Error("The track could not be attached.");
      return SAID;
    },
  };
}
