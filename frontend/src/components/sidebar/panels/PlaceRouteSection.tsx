// One place's Route section: the way in the slot, and "Add a way". The place
// page and the edit dialog both render this, so a way is added the same way
// from either.
import {
  ADD_WAY,
  PLACE_PAGE,
  formatDistanceM,
  mediaDisplayName,
  placeRoute,
  placeSectionTitle,
  routeLengthM,
  type MediaItem,
} from "@logjam/shared";
import { messageFromError } from "../../../errors/messageFromError";
import {
  linkMediaToPlace,
  updateRoute,
  type TPlace,
  type TRoute,
} from "../../../placeUtils";
import { Button, IconButton, IconTile, Row, SectionHeader } from "../../../ui";
import { useToast } from "../../feedback/ToastProvider";
import { boundsOfPoints } from "./waysModel";
import classes from "./PlaceDetailPanel.module.css";

// One route per place (the API enforces it): a FILE, so its row is a real link
// (middle-click, save as), wearing the glyph and hue a track wears on Ways.
export default function PlaceRouteSection({
  place,
  owned,
  shared,
  routes,
  media,
  onFocusBounds,
  onOpenRoute,
  onRoutesChanged,
  onReloadMedia,
  onDeleteFile,
  onAddWay,
  leaveBlockedReason,
}: {
  place: Pick<TPlace, "id" | "name">;
  owned: boolean;
  shared: boolean;
  /** Every drawn route the user can see; one may fill this place's slot. */
  routes: TRoute[];
  /** This place's attachments: a track file may fill the slot. */
  media: MediaItem[];
  onFocusBounds: (bounds: [number, number, number, number]) => void;
  onOpenRoute: (route: TRoute) => void;
  onRoutesChanged: () => void;
  onReloadMedia: () => void;
  onDeleteFile: (file: MediaItem) => void;
  /** Open the Add a way dialog, which its owner draws: a modal is not nested. */
  onAddWay: () => void;
  /** Why Open way cannot take the user away from where this is shown just
   *  now: it replaces the page, and a form over it goes too. */
  leaveBlockedReason?: string;
}) {
  const toast = useToast();
  const slot = placeRoute(place.id, routes, media);
  const track = slot?.kind === "file" ? slot.file : null;
  const drawnRoute = slot?.kind === "drawn" ? slot.route : null;

  return (
    <section className={classes.section}>
      <SectionHeader
        title={placeSectionTitle("route", PLACE_PAGE.copy.route, {
          owned,
          shared,
          filled: Boolean(track || drawnRoute),
        })}
      />
      {drawnRoute ? (
        <Row
          leading={<IconTile icon="route" hue="var(--hue-route)" />}
          title={drawnRoute.name}
          subtitle={`Drawn route · ${formatDistanceM(routeLengthM(drawnRoute.points))}`}
          onOpen={() => {
            const bounds = boundsOfPoints(drawnRoute.points);
            if (bounds) onFocusBounds(bounds);
          }}
          trailing={
            <>
              <IconButton
                icon="forward"
                label="Open way"
                onClick={() => onOpenRoute(drawnRoute)}
                {...(leaveBlockedReason
                  ? { disabled: true, disabledReason: leaveBlockedReason }
                  : { disabled: false })}
              />
              {owned && (
                <IconButton
                  icon="unlink"
                  label="Unlink from this place"
                  onClick={() => {
                    updateRoute(drawnRoute.id, { placeId: null })
                      .then(() => {
                        onRoutesChanged();
                        toast.done("Route unlinked.");
                      })
                      .catch((err: unknown) =>
                        toast.error(
                          messageFromError(err, "Couldn't unlink that route."),
                        ),
                      );
                  }}
                />
              )}
            </>
          }
        />
      ) : track ? (
        <Row
          leading={<IconTile icon="track" hue="var(--hue-track)" />}
          title={mediaDisplayName(track)}
          subtitle="Click to download"
          href={track.displayUrl}
          download={track.filename}
          trailing={
            owned ? (
              // An import or a recording is the user's own file, so it comes
              // off the place and stays; only a file uploaded here has no life
              // apart from the place and can only be deleted.
              track.origin !== null ? (
                <IconButton
                  icon="unlink"
                  label="Unlink from this place"
                  onClick={() => {
                    linkMediaToPlace(track.id, null)
                      .then(() => {
                        onReloadMedia();
                        toast.done("Route unlinked.");
                      })
                      .catch((err: unknown) =>
                        toast.error(
                          messageFromError(err, "Couldn't unlink that route."),
                        ),
                      );
                  }}
                />
              ) : (
                <IconButton
                  icon="delete"
                  label={`Delete the track ${mediaDisplayName(track)}`}
                  tone="danger"
                  onClick={() => onDeleteFile(track)}
                />
              )
            ) : undefined
          }
        />
      ) : (
        <p className={classes.muted}>{PLACE_PAGE.copy.routeEmpty}</p>
      )}
      {owned && (
        <div>
          <Button
            compact
            icon={drawnRoute || track ? "replace" : "add"}
            onClick={onAddWay}
          >
            {drawnRoute || track
              ? ADD_WAY.copy.replaceTitle
              : ADD_WAY.copy.title}
          </Button>
        </div>
      )}
    </section>
  );
}
