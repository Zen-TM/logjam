// "Add a way": every way of filling ONE place's single route slot, from the
// place page's Route section, with no edit dialog. Logjam GPS's `AddWaySheet`
// is the same panel; its words are `ADD_WAY`'s.
//
//   a route you drew      → the Route row is linked (Route.placeId)
//   a recorded track      → the stored recording is linked as the place's way
//   an imported file      → the stored import is linked as the place's way
//   a .gpx/.kml file      → uploaded onto the place
//
// Each list is a sub-view of this dialog, never a second dialog; the way out
// undoes one layer. A new way may displace the incumbent, and the confirm
// comes at the moment of the write, after a file has been chosen, so backing
// out of the picker agrees to nothing.
//
// PRIVACY: nothing here logs a filename, a place name or a coordinate.
import { useRef, useState } from "react";
import {
  ADD_WAY,
  IMPORT_TO_PLACE_PROMISE,
  addWayFileRow,
  addWayImportSubtitle,
  addWayNoImports,
  addWayNoTracks,
  formatDistanceM,
  mediaDisplayName,
  routeLengthM,
  routeSlotDisplaceConfirm,
  type MediaItem,
  type StandaloneFile,
  MEDIA_SIZE_CAPS,
  wayFailureMessage,
  WayRefusedError,
  WayRemovalError,
  type WaySource,
} from "@logjam/shared";
import {
  linkMediaToPlace,
  updateRoute,
  uploadMedia,
  useStandaloneFiles,
  type TRoute,
} from "../../placeUtils";
import {
  Button,
  Dialog,
  ErrorBanner,
  IconTile,
  Row,
  SearchField,
} from "../../ui";
import { useToast } from "../feedback/ToastProvider";
import { useConfirm } from "../sidebar/panels/useConfirm";
import { resolveMediaType } from "../media/mediaFiles";
import {
  attachableFiles,
  ownAttachableRoutes,
  fillWaySlot,
  slotIncumbent,
} from "./addWayModel";
import classes from "./AddWayDialog.module.css";

/** A recording knows its length; an import only sometimes. */
function metersOf(file: StandaloneFile): number | undefined {
  return "distanceM" in file.metadata ? file.metadata.distanceM : undefined;
}

type Mode = "sources" | "routes" | "tracks" | "imports";

export default function AddWayDialog({
  open,
  placeId,
  placeName,
  routes,
  currentUserId,
  media,
  onClose,
  onFilled,
}: {
  open: boolean;
  placeId: string;
  placeName: string;
  /** Every drawn route the user can see; only their own are offered. */
  routes: TRoute[];
  currentUserId: string | null;
  /** This place's attachments: half of what can be filling the slot. */
  media: MediaItem[];
  onClose: () => void;
  /** The slot changed: the page refetches its routes and media. */
  onFilled: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const fileInput = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>("sources");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Fetched only while the dialog is open: most visits to a place never add one.
  const { files, loaded, error: loadError } = useStandaloneFiles(open);

  const incumbent = slotIncumbent(placeId, routes, media);

  const close = () => {
    setMode("sources");
    setQuery("");
    setError(null);
    onClose();
  };

  /** Confirm what the displacement costs, write, say what happened. */
  const fill = (
    source: WaySource,
    write: (replaces?: string) => Promise<unknown>,
    done: string,
    preflight?: () => Promise<void>,
  ) => {
    const go = async () => {
      setBusy(true);
      setError(null);
      try {
        await fillWaySlot({ incumbent, source, write, preflight });
        toast.done(done);
        onFilled();
        close();
      } catch (err) {
        console.error(err);
        // The slot may have changed before the failure.
        onFilled();
        if (err instanceof WayRemovalError) {
          // The new way is in; only the old one stayed. Nothing left to retry
          // here, so leave the dialog and say so.
          toast.error(err.message);
          close();
        } else {
          setError(wayFailureMessage(err));
        }
      } finally {
        setBusy(false);
      }
    };
    const copy = routeSlotDisplaceConfirm("web", placeName, incumbent);
    if (copy) confirm.ask({ copy, run: go });
    else void go();
  };

  const pickFile = (file: File | undefined) => {
    if (!file) return;
    const resolved = resolveMediaType(file);
    if (resolved?.category !== "track") {
      setError(ADD_WAY.copy.notRouteFile);
      return;
    }
    fill(
      "file",
      (replaces) =>
        uploadMedia({
          linkedType: "place",
          linkedId: placeId,
          file,
          mediaType: resolved.mediaType,
          thumbnail: null,
          replaces,
        }),
      ADD_WAY.copy.fileDone,
      // Fail here on what can be known without uploading.
      async () => {
        if (file.size > MEDIA_SIZE_CAPS.track)
          throw new WayRefusedError(ADD_WAY.copy.tooLarge);
        await file.arrayBuffer();
      },
    );
  };

  const fileRow = addWayFileRow("web");
  const drawn = ownAttachableRoutes(routes, currentUserId, placeId, query);
  const recordings = attachableFiles(files, "track", placeId);
  const imports = attachableFiles(files, "import", placeId);

  const title =
    mode === "routes"
      ? ADD_WAY.copy.routeTitle
      : mode === "tracks"
        ? ADD_WAY.copy.trackTitle
        : mode === "imports"
          ? ADD_WAY.copy.importTitle
          : ADD_WAY.copy.title;

  const back = () => {
    setMode("sources");
    setQuery("");
    setError(null);
  };

  const fileList = (list: StandaloneFile[], source: "track" | "import") =>
    !loaded ? (
      <p className={classes.hint}>Loading…</p>
    ) : loadError ? (
      <ErrorBanner message={loadError} />
    ) : list.length === 0 ? (
      <p className={classes.hint}>
        {source === "track" ? addWayNoTracks("web") : addWayNoImports("web")}
      </p>
    ) : (
      list.map((file) => {
        const here = file.linkedPlaceId === placeId;
        return (
          <Row
            key={file.id}
            leading={
              <IconTile
                icon={
                  here
                    ? "success"
                    : source === "track"
                      ? "track"
                      : "importedFile"
                }
                hue={`var(--hue-${source})`}
              />
            }
            title={mediaDisplayName(file)}
            subtitle={
              here
                ? ADD_WAY.copy.alreadyHere
                : metersOf(file) !== undefined
                  ? formatDistanceM(metersOf(file)!)
                  : undefined
            }
            disabled={busy}
            onOpen={
              here
                ? undefined
                : () =>
                    fill(
                      source,
                      (replaces) =>
                        linkMediaToPlace(file.id, placeId, replaces),
                      ADD_WAY.copy.linkedDone,
                    )
            }
          />
        );
      })
    );

  return (
    <>
      <Dialog
        open={open}
        title={title}
        onClose={mode === "sources" ? close : back}
        dismissible={!busy}
        footer={
          mode === "sources" ? (
            <Button onClick={close} disabled={busy} disabledReason="Working…">
              Cancel
            </Button>
          ) : (
            <Button
              icon="back"
              onClick={back}
              disabled={busy}
              disabledReason="Working…"
            >
              Back
            </Button>
          )
        }
      >
        <div className={classes.body}>
          {error && <ErrorBanner message={error} />}

          {mode === "sources" && (
            <>
              <Row
                leading={<IconTile icon="route" hue="var(--hue-route)" />}
                title={ADD_WAY.copy.routeTitle}
                subtitle={ADD_WAY.copy.routeSubtitle}
                disabled={busy}
                onOpen={() => setMode("routes")}
              />
              <Row
                leading={<IconTile icon="track" hue="var(--hue-track)" />}
                title={ADD_WAY.copy.trackTitle}
                subtitle={ADD_WAY.copy.trackSubtitle}
                disabled={busy}
                onOpen={() => setMode("tracks")}
              />
              <Row
                leading={
                  <IconTile icon="importedFile" hue="var(--hue-import)" />
                }
                title={ADD_WAY.copy.importTitle}
                subtitle={addWayImportSubtitle("web")}
                disabled={busy}
                onOpen={() => setMode("imports")}
              />
              <Row
                leading={<IconTile icon="upload" hue="var(--hue-import)" />}
                title={fileRow.title}
                subtitle={fileRow.subtitle}
                disabled={busy}
                onOpen={() => fileInput.current?.click()}
              />
              <input
                ref={fileInput}
                type="file"
                accept=".gpx,.kml"
                className={classes.file}
                tabIndex={-1}
                aria-hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  // Reset so choosing the same file again still fires.
                  event.target.value = "";
                  pickFile(file);
                }}
              />
            </>
          )}

          {mode === "routes" && (
            <>
              <SearchField
                label={ADD_WAY.copy.findRoute}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              {drawn.length === 0 ? (
                <p className={classes.hint}>
                  {query ? ADD_WAY.copy.noRouteMatch : ADD_WAY.copy.noRoutes}
                </p>
              ) : (
                drawn.map((route) => {
                  const here = route.placeId === placeId;
                  return (
                    <Row
                      key={route.id}
                      leading={
                        <IconTile
                          icon={here ? "success" : "route"}
                          hue="var(--hue-route)"
                        />
                      }
                      title={route.name}
                      subtitle={
                        here
                          ? ADD_WAY.copy.alreadyHere
                          : formatDistanceM(routeLengthM(route.points))
                      }
                      disabled={busy}
                      onOpen={
                        here
                          ? undefined
                          : () =>
                              fill(
                                "route",
                                () => updateRoute(route.id, { placeId }),
                                ADD_WAY.copy.routeDone,
                              )
                      }
                    />
                  );
                })
              )}
            </>
          )}

          {mode === "tracks" && (
            <>
              <p className={classes.hint}>{IMPORT_TO_PLACE_PROMISE}</p>
              {fileList(recordings, "track")}
            </>
          )}

          {mode === "imports" && (
            <>
              <p className={classes.hint}>{IMPORT_TO_PLACE_PROMISE}</p>
              {fileList(imports, "import")}
            </>
          )}
        </div>
      </Dialog>
      {confirm.dialog}
    </>
  );
}
