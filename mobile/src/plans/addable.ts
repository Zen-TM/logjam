// What Add a copy offers from this phone: the mirror's rows narrowed to what
// the API will copy (the caller's own, already on the server), then shared
// `tripPlanAddable`'s rule (a route or file a ticked place brings is not
// offered twice). The API 404s anything else, which stops a run mid-loop.
import { tripPlanAddable, type GeoPdfJobView } from "@logjam/shared";

import type {
  MirrorMedia,
  MirrorPlace,
  MirrorRoute,
} from "../sync/mirrorStore";

export function addableFromMirror(
  own: {
    places: readonly MirrorPlace[];
    routes: readonly MirrorRoute[];
    /** Imports and recordings. */
    files: readonly MirrorMedia[];
    geoPdfs: readonly GeoPdfJobView[];
  },
  state: {
    me: string | null;
    /** Made on this phone and not pushed yet (`usePendingCreateIds`). */
    pendingCreates: ReadonlySet<string>;
    tickedPlaceIds: string[];
    copyMedia: boolean;
  },
) {
  const onServer = (id: string) => !state.pendingCreates.has(id);
  // A shared place is mirrored "shared"; one made here is "owner" before
  // its create lands, so it waits too.
  const places = own.places.filter(
    (place) => place.syncRole === "owner" && onServer(place.id),
  );
  const ownPlaceIds = new Set(places.map((place) => place.id));
  return tripPlanAddable(
    {
      places,
      // A null owner is a route not on the server yet: not the caller's.
      routes: own.routes
        .filter((route) => onServer(route.id))
        .map((route) => ({ ...route, ownerId: route.ownerId ?? "" })),
      // Uploaded, and not a shared place's way (the sharer's file, which a
      // sharee's mirror holds too).
      files: own.files
        .filter(
          (file) =>
            file.syncState === "synced" &&
            (file.linkedType !== "place" ||
              ownPlaceIds.has(file.linkedId ?? "")),
        )
        .map((file) => ({
          ...file,
          linkedPlaceId: file.linkedType === "place" ? file.linkedId : null,
        })),
      geoPdfs: [...own.geoPdfs],
    },
    {
      me: state.me,
      tickedPlaceIds: state.tickedPlaceIds,
      copyMedia: state.copyMedia,
    },
  );
}
