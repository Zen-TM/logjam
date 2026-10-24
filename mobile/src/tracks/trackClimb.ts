// A finished track's stored climb and descent: read from the best DEM at each
// point of the line, with the track's own GPS heights where no DEM answers,
// kept with the source it came from, and replaced later when a finer source
// can answer.
//
// STORED, NOT DERIVED ON READ. The Saved list, the Stats totals, the track
// sheet and Logjam Web all show the row's two figures, so they agree by
// construction and none of them reads terrain to draw a number. The cost is
// that a figure can be older than the best terrain available, which is what
// the source beside it and `upgradeTrackClimbs` are for.
//
// The arithmetic is the track sheet's (`useElevationProfile`): the same line,
// the same densifying, the same profile builder.
//
// PRIVACY: the line is precise location history. Nothing here logs, and a
// failure is reported by returning, never by printing: an error could carry
// the line or a tile index.
import { AppState } from "react-native";
import {
  DEM_SOURCES,
  ELEVATION_TRACK_MAX_SAMPLES,
  buildTrackElevationProfile,
  climbFromProfile,
  climbSourceOf,
  demSourcesFor,
  densifyLineSegments,
  isFinerClimbSource,
  type DemSource,
  type ElevationProfile,
  type GpsFix,
  type TrackClimb,
} from "@logjam/shared";

import { apiFetch } from "../api/apiFetch";
import { sampleElevationsOffline } from "../offline/demLookup";
import { savedSharpenedAreas } from "../offline/sharpenedAreaStore";
import { canRunNow } from "../offline/networkPolicy";
import { isOfflineOnly } from "../offline/offlineOnlyMode";
import { reclimbStandaloneMediaLocal } from "../sync/mediaUpload";
import { toElevationLine } from "@logjam/shared";
import {
  getTrack,
  listTrackPoints,
  listTracksDueClimbUpgrade,
  markTrackClimbChecked,
  updateTrack,
} from "./tracksDb";

/**
 * What a "nothing finer" answer was true of. A track the network had no finer
 * climb for is asked about again only when this changes: a source added, or
 * one whose footprint grew. Nothing polls.
 *
 * The upgrade pass keys on `demSourcesFor` the account's kept sharpened
 * areas, so a new area, or one grown, re-asks the tracks (ADR 0028's update
 * of 2026-10-23).
 *
 * ponytail: the declaration, not what is behind it. One change it cannot
 * see: an archive rebuilt to fill holes inside an unchanged `coverage`. Have
 * the API report a coverage version to compare if that matters.
 * `trackClimb.test.ts` holds what the key does see.
 */
export function climbSourcesKey(
  sources: readonly Pick<DemSource, "id" | "coverage">[] = DEM_SOURCES,
): string {
  return JSON.stringify(sources.map((source) => [source.id, source.coverage]));
}

/**
 * Tracks one pass reads. Each is a full read of a series and maybe a request,
 * inside a sync cycle someone is waiting on. A backlog still drains: a climb
 * that changes queues an op, the op schedules a cycle, and the cycle runs the
 * next pass.
 */
const TRACKS_PER_PASS = 3;

/**
 * The climb from the terrain SAVED ON THIS PHONE. Where it covers only part
 * of the line, `gpsFixes` (the track's own heights) fill the rest and
 * the climb is labelled GPS, so the upgrade pass still replaces it. Null when
 * a sample is left with no height at all. No request: this runs at the finish
 * tap, in a place with no signal as often as not. Never throws: a track must
 * finish whether or not the terrain can be read.
 */
export async function climbFromSavedTerrain(
  segments: readonly (readonly [number, number][])[],
  gpsFixes?: readonly (readonly GpsFix[])[],
): Promise<TrackClimb | null> {
  try {
    const positions = densifyLineSegments(
      segments,
      ELEVATION_TRACK_MAX_SAMPLES,
    );
    return climbFromProfile(
      buildTrackElevationProfile(
        segments,
        gpsFixes,
        positions,
        await sampleElevationsOffline(positions),
      ),
    );
  } catch {
    return null;
  }
}

/**
 * Store a climb on a finished track if it came from a finer source than the
 * one stored, and send it to the account's copy. Returns whether it did.
 *
 * Reads the row itself rather than trusting the caller's copy: a sheet can
 * hold a track object older than the last upgrade.
 */
export async function storeTrackClimb(
  trackId: string,
  climb: TrackClimb | null,
): Promise<boolean> {
  if (!climb) return false;
  const track = await getTrack(trackId);
  // A live recording's figures are the recorder's until it finishes.
  if (!track || track.state !== "done") return false;
  if (!isFinerClimbSource(climb.elevationSource, track.elevationSource))
    return false;
  await updateTrack(trackId, { climb });
  if (track.mediaId) await reclimbStandaloneMediaLocal(track.mediaId, climb);
  return true;
}

/**
 * Replace stored climbs that a finer source can now answer: a track finished
 * out of range on GPS heights, and every track recorded before climbs came
 * from the DEM.
 *
 * Called from the sync cycle, so it runs only for a signed-in account and
 * only when a cycle does. On top of that it does NOTHING, not even a read,
 * when Logjam GPS is behind another app, when the map is in offline-only mode,
 * or on a connection sync may not use.
 *
 * Asks the saved terrain first and then our own API, never the public tile
 * host: nobody is looking at a screen, so the request that would trace the
 * track from the user's own connection is not worth making. The API already
 * holds the track's file.
 *
 * Returns how many it replaced: a count, never a name or a place.
 */
export async function upgradeTrackClimbs(): Promise<number> {
  if (AppState.currentState === "background" || isOfflineOnly()) return 0;
  if (!(await canRunNow("sync"))) return 0;
  const sources = demSourcesFor(await savedSharpenedAreas());
  const key = climbSourcesKey(sources);
  // Finest first: the order is the precedence. With an area, `lidar`.
  const finest = climbSourceOf(sources[0]!.id);
  const due = await listTracksDueClimbUpgrade(finest, key, TRACKS_PER_PASS);
  let replaced = 0;
  for (const track of due) {
    const segments = toElevationLine(await listTrackPoints(track.id));
    let climb = await climbFromSavedTerrain(segments);
    // Unreachable, rate limited or too old to have the route: true of every
    // track left, so the pass stops and this one stays unmarked for next time.
    let linkFailed = false;
    if (segments.length > 0 && climb?.elevationSource !== finest) {
      try {
        const answered = climbFromProfile(
          await apiFetch<ElevationProfile>("/elevation/profile", {
            method: "POST",
            body: { segments, maxSamples: ELEVATION_TRACK_MAX_SAMPLES },
          }),
        );
        if (
          answered &&
          (!climb ||
            isFinerClimbSource(answered.elevationSource, climb.elevationSource))
        )
          climb = answered;
      } catch (err) {
        // A 400 is about THIS line and will be the same answer next time; it
        // is marked like any other track the network had nothing for, or it
        // would head the list and stop every later pass.
        linkFailed = (err as { status?: number }).status !== 400;
      }
    }
    // What the saved terrain gave is kept even when the request failed.
    if (await storeTrackClimb(track.id, climb)) replaced += 1;
    if (linkFailed) break;
    // Marked whether or not anything changed: a track still short of the
    // finest source (outside its footprint, say) must not be read again on
    // every cycle.
    await markTrackClimbChecked(track.id, key);
  }
  return replaced;
}
