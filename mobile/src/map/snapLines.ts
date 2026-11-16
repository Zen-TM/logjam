// Where the map tools get their snapping geometry.
//
// Reads a Protomaps PMTiles archive directly (`shared/src/snapTiles.ts`), NOT
// the rendered map: querying the rendered map would tie snapping to the active
// basemap and zoom level, and truncate ways continuing off-screen.
//
// OFFLINE: a downloaded basemap region IS a .pmtiles file in app-private
// storage, so when the segment falls inside one, the same reader is pointed at
// that file over ranged reads and snapping works with no signal at all.
// Outside a saved region it is an HTTP range request, and with no signal the
// tools fall back to the straight line they would have drawn anyway. That is
// the same boundary the offline basemap already draws: inside a saved area you
// have the data, outside it you don't.
//
// PRIVACY: the bbox comes from where the user is drawing. It selects tiles to
// range-request from our own CDN — or, offline, byte ranges of a local file —
// and is never sent as a query. Nothing logs.
import * as FileSystem from "expo-file-system/legacy";
import {
  fetchSnapLines,
  snapArchiveFor,
  type SnapArchive,
  type SnapLine,
  type SnapMode,
  type VectorArchive,
} from "@logjam/shared";

import { config } from "../config";
import type { MapArtifact } from "./sourceResolver";
import { regionCovering } from "./snapRegion";

/**
 * The remote archive of the region the segment is in. Same host the vector
 * basemap itself streams from, so snapping needs no new network permission or
 * endpoint.
 */
const archiveUrl = (archive: VectorArchive) =>
  `${config.topoCdnBaseUrl}/${archive.archivePath}`;

/**
 * A pmtiles `Source` over a local file.
 *
 * expo-file-system reads a byte range as base64, which is what makes this
 * possible without a native module: `position`/`length` map straight onto the
 * range request the PMTiles reader would otherwise issue. Reads are small (the
 * header, a directory page, one tile), so the base64 round-trip is not worth
 * optimising away.
 */
export function fileSource(path: string): SnapArchive {
  const uri = `file://${path}`;
  return {
    getKey: () => uri,
    getBytes: async (offset: number, length: number) => {
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
        position: offset,
        length,
      });
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return { data: bytes.buffer };
    },
  };
}

/**
 * Candidate ways for the segment between two points. Empty when snapping is
 * off, or when the archive can't be reached — both normal outcomes the caller
 * renders as a straight line.
 */
export function collectSnapLines(
  mode: SnapMode,
  from: [number, number],
  to: [number, number],
  /** Downloaded artifacts, so a saved region can serve this with no signal. */
  artifacts: readonly MapArtifact[] = [],
): Promise<SnapLine[]> {
  // The archive of the region the segment is in; with none, a straight line.
  const archive = snapArchiveFor(from, to);
  if (!archive) return Promise.resolve([]);
  const saved = regionCovering(artifacts, from, to, archive.archivePath);
  return fetchSnapLines(
    saved ? fileSource(saved.path) : archiveUrl(archive),
    mode,
    from,
    to,
  );
}
