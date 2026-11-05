// "Add a way" for a trip being logged: the body of a mode of the trip form,
// never a second dialog. The words are `ADD_WAY`'s and `TRIP_FORM`'s; Logjam
// GPS's `AddWaySheet` (with `forTrip`) is the same panel.
//
//   a route you drew      → its line, written out as a GPX
//   a recorded track      → a copy of its file, naming the recording
//   an imported file      → a copy of its file
//   a .gpx/.kml file      → that file
//
// There is no pen: drawing writes a route linked to a place, and a trip keeps
// files, not routes.
//
// PRIVACY: nothing here logs a filename, a route name or a coordinate.
import { useContext, useRef, useState } from "react";
import {
  ADD_WAY,
  addWayFileRow,
  addWayImportSubtitle,
  addWayNoImports,
  addWayNoTracks,
  formatDistanceM,
  mediaDisplayName,
  MEDIA_SIZE_CAPS,
  routeLengthM,
  routesMatching,
  TRIP_FORM,
  type StandaloneFile,
} from "@logjam/shared";
import { CurrentUserIdContext } from "../../CurrentUserIdContext";
import { useRoutes, useStandaloneFiles } from "../../placeUtils";
import { Button, ErrorBanner, IconTile, Row, SearchField } from "../../ui";
import { resolveMediaType } from "../media/mediaFiles";
import { fetchMediaFile, routeGpxFile, tripFiles } from "./tripWayModel";
import classes from "./AddWayDialog.module.css";

/** A way the user chose: what to call it, and how to get its file. */
export type TripWay = {
  name: string;
  load: () => Promise<File>;
  /** The recording this is a copy of, so it stops offering "Log a trip". */
  sourceMediaId?: string;
};

type Mode = "sources" | "routes" | "tracks" | "imports";

export default function TripWayPicker({
  busy,
  error,
  onPick,
}: {
  busy: boolean;
  error: string | null;
  onPick: (way: TripWay) => void;
}) {
  const currentUserId = useContext(CurrentUserIdContext);
  const fileInput = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>("sources");
  const [query, setQuery] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const { routes } = useRoutes(true);
  const { files, loaded, error: loadError } = useStandaloneFiles(true);

  const back = () => {
    setMode("sources");
    setQuery("");
  };

  const pickFile = (file: File | undefined) => {
    if (!file) return;
    if (resolveMediaType(file)?.category !== "track") {
      setFileError(ADD_WAY.copy.notRouteFile);
      return;
    }
    if (file.size > MEDIA_SIZE_CAPS.track) {
      setFileError(ADD_WAY.copy.tooLarge);
      return;
    }
    setFileError(null);
    onPick({ name: file.name, load: async () => file });
  };

  const fileRow = addWayFileRow("web", "trip");
  const drawn = routesMatching(
    routes.filter((route) => route.ownerId === currentUserId),
    query,
  );

  const fileList = (source: "track" | "import") => {
    const list = tripFiles(files, source);
    if (!loaded) return <p className={classes.hint}>Loading…</p>;
    if (loadError) return <ErrorBanner message={loadError} />;
    if (list.length === 0)
      return (
        <p className={classes.hint}>
          {source === "track" ? addWayNoTracks("web") : addWayNoImports("web")}
        </p>
      );
    return list.map((file: StandaloneFile) => (
      <Row
        key={file.id}
        leading={
          <IconTile
            icon={source === "track" ? "track" : "importedFile"}
            hue={`var(--hue-${source})`}
          />
        }
        title={mediaDisplayName(file)}
        subtitle={
          "distanceM" in file.metadata && file.metadata.distanceM !== undefined
            ? formatDistanceM(file.metadata.distanceM)
            : undefined
        }
        disabled={busy}
        onOpen={() =>
          onPick({
            name: mediaDisplayName(file),
            load: () => fetchMediaFile(file.id, file.filename),
            // The API takes a source only from a recording.
            sourceMediaId: source === "track" ? file.id : undefined,
          })
        }
      />
    ));
  };

  return (
    <div className={classes.body}>
      {(error ?? fileError) && <ErrorBanner message={(error ?? fileError)!} />}

      {mode === "sources" ? (
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
            leading={<IconTile icon="importedFile" hue="var(--hue-import)" />}
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
      ) : (
        <Button
          icon="back"
          onClick={back}
          disabled={busy}
          disabledReason="Adding…"
        >
          Back
        </Button>
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
            drawn.map((route) => (
              <Row
                key={route.id}
                leading={<IconTile icon="route" hue="var(--hue-route)" />}
                title={route.name}
                subtitle={formatDistanceM(routeLengthM(route.points))}
                disabled={busy}
                onOpen={() =>
                  onPick({
                    name: route.name,
                    load: async () => routeGpxFile(route),
                  })
                }
              />
            ))
          )}
        </>
      )}

      {mode === "tracks" && (
        <>
          <p className={classes.hint}>{TRIP_FORM.copy.wayCopiedHint}</p>
          {fileList("track")}
        </>
      )}

      {mode === "imports" && (
        <>
          <p className={classes.hint}>{TRIP_FORM.copy.wayCopiedHint}</p>
          {fileList("import")}
        </>
      )}
    </div>
  );
}
