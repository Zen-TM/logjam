// What Logjam Web's trip form decides about a way, away from the DOM. A trip
// keeps a way as a COPY of a file on it (the API links a trip's files, never a
// way), so every ADD_WAY source but the pen becomes a File that is uploaded
// onto the draft trip: the original is never touched and survives the trip.
// Logjam GPS's `logs/tripWays.ts` is the same decision over its own mirror.
import {
  GPX_MIME_TYPE,
  mediaCategory,
  routeToGpx,
  type StandaloneFile,
} from "@logjam/shared";
import { getMediaDownloadUrls, type TRoute } from "../../placeUtils";

/** The user's recordings or imports a trip can copy: every route file of that
 *  origin. Unlike a place's slot, a file already on a place is fine, since the
 *  trip takes a copy and leaves the place alone. */
export function tripFiles(
  files: readonly StandaloneFile[],
  origin: StandaloneFile["origin"],
): StandaloneFile[] {
  return files.filter(
    (file) =>
      file.origin === origin && mediaCategory(file.mediaType) === "track",
  );
}

/** A stored file's bytes, as a File to upload again. */
export async function fetchMediaFile(
  mediaId: string,
  filename: string,
): Promise<File> {
  const { items } = await getMediaDownloadUrls([mediaId]);
  const url = items[0]?.displayUrl;
  if (!url) throw new Error("The file could not be fetched.");
  const response = await fetch(url);
  if (!response.ok) throw new Error("The file could not be fetched.");
  return new File([await response.blob()], filename);
}

/** A drawn route's line, written out as the GPX a track upload takes. */
export function routeGpxFile(route: Pick<TRoute, "name" | "points">): File {
  return new File([routeToGpx(route.name, route.points)], `${route.name}.gpx`, {
    type: GPX_MIME_TYPE,
  });
}
