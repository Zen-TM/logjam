// "Add a way" — every way of filling ONE canyon's single route slot, in one
// panel.
//
// It used to be the `kind === "track"` branch of MediaStrip's source sheet,
// titled "Add a route", reachable only while the slot was EMPTY, and offering
// three of the five things that can go in it. The canyon screen's own ⋯ then
// offered a fourth path ("Replace with another route") that could only be
// filled by a drawn route. So which sources existed depended on how you got
// there, and replacing was narrower than adding.
//
// Now: one panel, rendered from the empty slot AND from the replace path, with
// all five sources. "Way" is this codebase's umbrella word for route-or-track
// in prose and labels — the `Route` and `Track` TYPES stay distinct
// (mobile/CLAUDE.md).
//
//   a route you drew   → the Route row is linked (Route.canyonId)
//   an import          → a COPY of its stored original is uploaded as media
//   a recorded track   → a Route is CREATED from it and that is linked; the
//                        recording is an observation and is never linked
//   a .gpx/.kml file   → uploaded as media
//   draw on the map    → hands over to the map's pen; the save writes the link
//
// Every one of them may displace an incumbent, and NONE of them decides what
// that costs: `routeSlot.ts` owns the occupant, the sentence and the write
// order, and `fillRouteSlot.ts` is the only thing that acts on them. The
// confirm happens at the moment of the WRITE, not when the source is picked —
// three of the five have not chosen a file yet at that point, and confirming a
// deletion the user can still back out of is how a file goes missing.
//
// Each list is a SUB-MODE of this sheet, never a second sheet (DESIGN.md §6),
// and every sub-mode resets on the sheet's OPEN edge, because the canyon screen
// closes it from outside.
//
// PRIVACY: nothing here logs a filename, a canyon name or a coordinate; the
// error paths carry our own copy.
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { formatDistanceM, messageFromError, routeLengthM } from "@logjam/shared";

import { assetHue, fontSize, spacing, theme } from "../theme";
import { BottomSheet, Row, SectionHeader, TextField } from "../ui";
import { attachMediaLocal } from "../sync/mediaUpload";
import { updateRouteLocal } from "../sync/outbox";
import { useMirrorRoutes } from "../sync/useSyncQueries";
import type { MirrorMedia } from "../sync/mirrorStore";
import { routeFileMimeType } from "../media/routeFileMime";
import { listVectorImports, type VectorImport } from "../imports/importsDb";
import { listTracks, type Track } from "../tracks/tracksDb";
import { trackActions, vectorImportActions } from "../saved/assetActions";
import { fillRouteSlot } from "./fillRouteSlot";
import {
  IMPORT_TO_CANYON_PROMISE,
  TRACK_TO_ROUTE_PROMISE,
  routeSlotOccupant,
  type WaySource,
} from "./routeSlot";

type Mode = "sources" | "routes" | "imports" | "tracks";

export function AddWaySheet({
  canyonId,
  canyonName,
  media,
  visible,
  onClose,
  onDrawRoute,
  onInfo,
  onError,
}: {
  canyonId: string;
  canyonName: string;
  /** This canyon's attachments — half of what can be occupying the slot. */
  media: MirrorMedia[];
  visible: boolean;
  onClose: () => void;
  /** Arm the map's pen for this canyon. Absent when the host has no map. */
  onDrawRoute?: () => void;
  onInfo: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [mode, setMode] = useState<Mode>("sources");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [imports, setImports] = useState<VectorImport[] | null>(null);
  const [tracks, setTracks] = useState<Track[] | null>(null);
  /**
   * Work deferred until this sheet has fully closed. A system picker launched
   * from inside an open Modal can never attach its own window, and its promise
   * simply never settles — the button looks dead (DESIGN.md §7).
   */
  const [pending, setPending] = useState<null | (() => Promise<void>)>(null);

  const routes = useMirrorRoutes();

  // Sub-modes reset on the OPEN edge, not only in this sheet's own close: the
  // canyon screen drops it from outside (a delete, a navigation), and none of
  // those run `close()`. Without this the next open lands in the last list.
  useEffect(() => {
    if (visible) {
      setMode("sources");
      setQuery("");
    }
  }, [visible]);

  // Loaded when their list opens, not on mount — this sheet is mounted for the
  // whole life of the canyon screen and most visits never add a way.
  useEffect(() => {
    if (mode !== "imports") return;
    let cancelled = false;
    listVectorImports()
      .then((all) => {
        if (!cancelled) setImports(all);
      })
      .catch((err: unknown) => {
        console.error(err);
        if (!cancelled) setImports([]);
      });
    return () => {
      cancelled = true;
    };
  }, [mode]);

  useEffect(() => {
    if (mode !== "tracks") return;
    let cancelled = false;
    listTracks()
      .then((all) => {
        if (!cancelled) setTracks(all.filter((track) => track.state === "done"));
      })
      .catch((err: unknown) => {
        console.error(err);
        if (!cancelled) setTracks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [mode]);

  const close = useCallback(() => {
    setMode("sources");
    onClose();
  }, [onClose]);

  /**
   * THE write. Confirm what the incumbent's displacement costs, swap in the
   * documented order, then say what happened — once, for every source.
   */
  const fill = useCallback(
    (source: WaySource, write: () => Promise<string>) => {
      setBusy(true);
      // The write's own sentence, said only once the swap has finished — a
      // toast fired before the incumbent is gone would describe a slot that
      // still holds two things.
      let message = "";
      fillRouteSlot({
        canyonName,
        source,
        occupant: routeSlotOccupant(canyonId, routes.data ?? [], media),
        write: () =>
          write().then((said) => {
            message = said;
          }),
      })
        .then((filled) => {
          if (!filled) return;
          onInfo(message);
          close();
        })
        .catch((err: unknown) => {
          console.error(err);
          onError(messageFromError(err, "Couldn't set that as this canyon's route."));
        })
        .finally(() => setBusy(false));
    },
    [canyonId, canyonName, close, media, onError, onInfo, routes.data],
  );

  /** Close first, then run — every system picker needs a window of its own. */
  const runAfterSheet = useCallback(
    (job: () => Promise<void>) => {
      setPending(() => job);
      close();
    },
    [close],
  );

  const pickFile = useCallback(async () => {
    const result = await DocumentPicker.getDocumentAsync({
      // Android reports .gpx/.kml inconsistently, so accept anything and let
      // the extension decide (routeFileMime.ts).
      type: "*/*",
      copyToCacheDirectory: true,
    });
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0];
    const mimeType = routeFileMimeType(asset.name, asset.mimeType);
    if (mimeType === null) {
      onError("Pick a .gpx or .kml file.");
      return;
    }
    // The confirm comes AFTER the file is chosen: a user who backs out of the
    // picker must not have agreed to delete anything.
    fill("file", async () => {
      await attachMediaLocal("canyon", canyonId, {
        uri: asset.uri,
        mimeType,
        fileName: asset.name,
      });
      return "Route file attached to this canyon.";
    });
  }, [canyonId, fill, onError]);

  const drawnRoutes = (routes.data ?? [])
    // A route shared with you belongs to someone else; the API refuses the
    // write, so it must not be offered.
    .filter((route) => route.syncRole !== "shared")
    .filter((route) => {
      const needle = query.trim().toLowerCase();
      return !needle || route.name.toLowerCase().includes(needle);
    });

  // A verb that can only refuse is absent (DESIGN.md §7): an import with no
  // .gpx/.kml original, and a recording too short to make a route from, both
  // withhold their descriptor, so neither reaches this list.
  const attachableImports = (imports ?? []).filter(
    (row) => vectorImportActions(row).attachToCanyon != null,
  );
  const convertibleTracks = (tracks ?? []).filter(
    (track) => trackActions(track).createRouteFrom != null,
  );

  return (
    <BottomSheet
      visible={visible}
      // A sub-mode backs out to the source list, not out of the sheet.
      onClose={mode === "sources" ? close : () => setMode("sources")}
      onBack={mode === "sources" ? undefined : () => setMode("sources")}
      onClosed={() => {
        const job = pending;
        if (!job) return;
        setPending(null);
        // A picker flow can reject (a cancelled folder grant, a failed read);
        // unhandled here it was an unhandled rejection and the row looked dead.
        void job().catch((err: unknown) => {
          console.error(err);
          onError("That didn't work. Please try again.");
        });
      }}
      title={
        mode === "routes"
          ? "Use a route you drew"
          : mode === "imports"
            ? "Use an imported file"
            : mode === "tracks"
              ? "Use a recorded track"
              : "Add a way"
      }
      header={
        mode === "routes" ? (
          <View style={styles.header}>
            <TextField label="Find a route" value={query} onChangeText={setQuery} />
          </View>
        ) : undefined
      }
    >
      {mode === "sources" ? (
        <View style={styles.body}>
          <Row
            icon="edit-3"
            hue={assetHue.route}
            title="Use a route you drew"
            subtitle="One of your saved routes"
            disabled={busy}
            onPress={() => setMode("routes")}
          />
          <Row
            icon="file-plus"
            hue={assetHue.import}
            title="Use an imported file"
            subtitle="A GPX or KML in Saved"
            disabled={busy}
            onPress={() => setMode("imports")}
          />
          <Row
            icon="activity"
            hue={assetHue.track}
            title="Use a recorded track"
            subtitle="A track you recorded in Logjam"
            disabled={busy}
            onPress={() => setMode("tracks")}
          />
          <Row
            icon="map"
            hue={assetHue.route}
            title="Attach a route file"
            subtitle="A .gpx or .kml from this phone"
            disabled={busy}
            onPress={() => runAfterSheet(pickFile)}
          />
          {onDrawRoute ? (
            <Row
              icon="pen-tool"
              hue={assetHue.route}
              title="Draw one on the map"
              subtitle="Opens the map with the pen ready"
              disabled={busy}
              onPress={() => {
                close();
                onDrawRoute();
              }}
            />
          ) : null}
          {busy ? <ActivityIndicator color={theme.accent} /> : null}
        </View>
      ) : null}

      {mode === "routes" ? (
        <View style={styles.body}>
          {drawnRoutes.length === 0 ? (
            <Text style={styles.hint}>
              {query
                ? "No route of yours matches that."
                : "You haven't drawn any routes yet."}
            </Text>
          ) : (
            drawnRoutes.map((route) => {
              const here = route.canyonId === canyonId;
              return (
                <Row
                  key={route.id}
                  title={route.name}
                  subtitle={
                    here
                      ? "Already this canyon's route"
                      : formatDistanceM(routeLengthM(route.points))
                  }
                  icon={here ? "check" : "edit-3"}
                  hue={here ? theme.accent : assetHue.route}
                  disabled={busy || here}
                  onPress={() =>
                    fill("route", async () => {
                      await updateRouteLocal(route.id, { canyonId });
                      return "Route attached to this canyon.";
                    })
                  }
                />
              );
            })
          )}
        </View>
      ) : null}

      {mode === "imports" ? (
        <View style={styles.body}>
          <Text style={styles.hint}>{IMPORT_TO_CANYON_PROMISE}</Text>
          {imports === null ? (
            <ActivityIndicator color={theme.accent} />
          ) : attachableImports.length === 0 ? (
            <Text style={styles.hint}>
              No imported GPX or KML on this phone. Import one from Saved and it
              shows up here.
            </Text>
          ) : (
            attachableImports.map((row) => (
              <Row
                key={row.id}
                icon="file-plus"
                hue={row.color}
                title={row.name}
                disabled={busy}
                onPress={() =>
                  fill("import", async () => {
                    await vectorImportActions(row).attachToCanyon!(canyonId);
                    return "Attached a copy as this canyon's route.";
                  })
                }
              />
            ))
          )}
        </View>
      ) : null}

      {mode === "tracks" ? (
        <View style={styles.body}>
          <Text style={styles.hint}>{TRACK_TO_ROUTE_PROMISE}</Text>
          {tracks === null ? (
            <ActivityIndicator color={theme.accent} />
          ) : convertibleTracks.length === 0 ? (
            <Text style={styles.hint}>
              No finished recording here is long enough to make a route from.
              Start one from the map and it shows up here once you stop it.
            </Text>
          ) : (
            <>
              <SectionHeader label={`${convertibleTracks.length} finished`} />
              {convertibleTracks.map((track) => (
                <Row
                  key={track.id}
                  icon="activity"
                  hue={track.color}
                  title={track.name}
                  subtitle={trackSummary(track)}
                  disabled={busy}
                  onPress={() =>
                    fill("track", async () => {
                      const { name, pointCount } =
                        await trackActions(track).createRouteFrom!(canyonId);
                      // RDP always throws points away; saying how many survived
                      // is what stops the user concluding the app lost their
                      // recording.
                      return `Saved “${name}” — ${pointCount} points — as this canyon's route. The recording is unchanged.`;
                    })
                  }
                />
              ))}
            </>
          )}
        </View>
      ) : null}
    </BottomSheet>
  );
}

function trackSummary(track: Track): string {
  const km = track.distanceM / 1000;
  const distance = km >= 1 ? `${km.toFixed(1)} km` : `${Math.round(track.distanceM)} m`;
  const minutes = Math.round(track.durationMs / 60000);
  const duration =
    minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
  return `${distance} · ${duration}`;
}

const styles = StyleSheet.create({
  header: { gap: spacing(1) },
  body: { gap: spacing(1) },
  hint: { color: theme.textMuted, fontSize: fontSize.xs },
});
