import { Feather } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import * as MediaLibrary from "expo-media-library";
import {
  categoryHasThumbnail,
  mediaCategory,
  trackPointsToGpx,
  type MediaCategory,
} from "@logjam/shared";

import { fontSize, fontWeight, radius, scrim, spacing, theme, withAlpha } from "../theme";
import { attachMediaLocal, deleteMediaLocal } from "../sync/mediaUpload";
import type { MirrorMedia } from "../sync/mirrorStore";
import { scratchFileUri } from "../offline/localStores";
import { savesCapturesToGallery } from "./galleryPreference";
import { alertPermissionDenied } from "../permissionAlert";
import { routeFileMimeType } from "./routeFileMime";
import { listTrackPoints, listTracks, type Track } from "../tracks/tracksDb";
import { BottomSheet, Row, SectionHeader } from "../ui";
import { MediaViewer } from "./MediaViewer";

/**
 * Attachment strip for a canyon or a trip — the one media surface, used by both
 * detail screens.
 *
 * Not in `src/ui`: it owns picker permissions, file copying and outbox writes,
 * so it is a feature component that happens to be shared, not a kit primitive.
 *
 * Offline-first (§7.1/§7.3): a pendingUpload row renders immediately from its
 * local copy and carries an "Uploading…" badge; synced thumbs come from the
 * eager offline cache. Tapping opens it, long-press deletes after a confirm.
 * Adding queues through the outbox, so every source works with no signal.
 *
 * Sources live in a sheet rather than an Alert: there are five, they need
 * glyphs, one needs a sub-step (which recorded track), and Android's Alert caps
 * at three buttons — which is why "Take photo" used to be unreachable.
 *
 * PRIVACY: a photo is location evidence and a recorded track IS precise
 * location history. Nothing here leaves the device except through the outbox's
 * authed upload; the error paths carry no filenames, canyon names or
 * coordinates.
 */

/**
 * Copy a just-captured file into the phone's gallery, if the user asked for
 * that (`galleryPreference.ts`).
 *
 * WRITE-ONLY permission: nothing in this app reads the gallery — the library
 * picker is expo-image-picker's own, with its own grant — so this asks for the
 * smallest scope that can do the job.
 *
 * Every failure is silent, deliberately, and this is the one place in the file
 * where that is right. The user's actual request (attach this photo) is about
 * to succeed either way; interrupting it with an alert about a side copy, on a
 * ledge, is worse than the copy not existing. A denial is not re-asked either —
 * expo remembers `canAskAgain`, and the switch in Settings is where someone who
 * wants this goes back to.
 *
 * PRIVACY: the file leaves app-private storage here and lands somewhere this
 * app no longer controls. That is the whole content of the preference, and why
 * this function is never called without checking it.
 */
async function saveToGalleryIfWanted(uri: string): Promise<void> {
  if (!savesCapturesToGallery()) return;
  try {
    const existing = await MediaLibrary.getPermissionsAsync(true);
    const permission = existing.granted
      ? existing
      : await MediaLibrary.requestPermissionsAsync(true);
    if (!permission.granted) return;
    await MediaLibrary.saveToLibraryAsync(uri);
  } catch (err) {
    // No filename, no path: this is media on a canyon.
    console.error("Gallery copy failed", err instanceof Error ? err.name : "unknown");
  }
}

type SourceMode = "sources" | "tracks";

export function MediaStrip({
  kind,
  online = true,
  linkedType,
  linkedId,
  media,
  emptyHint,
  limit,
  onFailed,
  onShowRoute,
  onAddWay,
}: {
  /**
   * Which family of attachment this strip owns. Photos/videos and route files
   * are separate strips (as on the web) because they answer different questions
   * — "what did it look like" vs "where did we go" — and mixing them makes a
   * photo roll you have to visually filter.
   */
  kind: "media" | "track";
  /**
   * Whether uploads can actually move. A queued attachment says "Uploading…"
   * when that is true and "Waiting" when it isn't — a spinner-flavoured label
   * that never finishes reads as a bug rather than as a queue.
   */
  online?: boolean;
  linkedType: "canyon" | "tripLog";
  linkedId: string;
  /** All attachments for the row; this strip shows only its own `kind`. */
  media: MirrorMedia[];
  /** Shown after the add tile when there are no attachments yet. */
  emptyHint?: string;
  /**
   * How many attachments this strip accepts. At the limit the add tile is
   * replaced by a line saying so, rather than left there to fail on upload.
   *
   * A canyon takes exactly ONE route: the API rejects a second with 409 "This
   * canyon already has a track" (`api/src/routes/media.ts`), and a rejected
   * upload would sit in the outbox as a dead push. Photos are uncapped.
   */
  limit?: number;
  /** Routed to the screen's toast channel; falls back to an Alert. */
  onFailed?: (message: string) => void;
  /**
   * Show a route attachment on the map. Given for `kind="track"`, a tap opens
   * the map rather than the viewer — a line on a basemap is the only useful way
   * to read a GPX, and a full-screen "open it elsewhere" page is a dead end.
   */
  onShowRoute?: (item: MirrorMedia) => void;
  /**
   * The canyon route slot's own panel ("Add a way"), owned by the canyon screen
   * — a canyon's slot can be filled five ways, three of which are not media at
   * all, so this strip does not try to offer them. Given, the add tile opens
   * that panel instead of this component's own source sheet, and the tile
   * survives the limit as "Replace". A TRIP has no slot and no limit, passes
   * nothing, and keeps the two file sources below.
   */
  onAddWay?: () => void;
}) {
  const [sourceMode, setSourceMode] = useState<SourceMode | null>(null);
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  /**
   * Work deferred until the source sheet has fully closed.
   *
   * Every system picker AND every permission request has to run with no Modal
   * on screen. `requestCameraPermissionsAsync()` called from inside the open
   * sheet never resolves at all — the dialog has no window to attach to, so the
   * promise simply hangs and the button looks dead. Closing first and running
   * the job from the sheet's `onClosed` is the only ordering that works.
   */
  const [pending, setPending] = useState<null | (() => void | Promise<void>)>(null);
  const runAfterSheet = useCallback((job: () => void | Promise<void>) => {
    setPending(() => job);
    setSourceMode(null);
  }, []);

  const fail = useCallback(
    (message: string) => {
      if (onFailed) onFailed(message);
      else Alert.alert("Couldn't attach that", message);
    },
    [onFailed],
  );

  const attach = useCallback(
    async (file: { uri: string; mimeType?: string | null; fileName?: string | null }) => {
      setBusy(true);
      try {
        await attachMediaLocal(linkedType, linkedId, file);
      } catch (err) {
        console.error(err);
        fail("That file couldn't be attached.");
      } finally {
        setBusy(false);
      }
    },
    [fail, linkedId, linkedType],
  );

  const captureFrom = useCallback(
    async (source: "camera" | "library", kind: "photo" | "video") => {
      // NO permission call for the camera here. `launchCameraAsync` always asks
      // natively (ImagePickerModule.ensureCameraPermissionsAreGranted), so a
      // second ask from JS is redundant — and on this device that ask is exactly
      // what hangs: expo's permission request for CAMERA never invokes its
      // callback, so the promise never settles and the button appears dead.
      // Asking once, natively, is the smaller surface until that is resolved.
      if (source === "library") {
        const existing = await ImagePicker.getMediaLibraryPermissionsAsync();
        const permission = existing.granted
          ? existing
          : await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          alertPermissionDenied({
            title: "Photo access needed",
            askAgainMessage:
              "Allow photo library access to attach photos and videos.",
            settingsMessage:
              "Photo access was previously denied. Enable it for Logjam in system settings.",
            canAskAgain: permission.canAskAgain,
          });
          return;
        }
      }
      const mediaTypes: ImagePicker.MediaType[] =
        kind === "video" ? ["videos"] : source === "camera" ? ["images"] : ["images", "videos"];
      let result: ImagePicker.ImagePickerResult;
      try {
        result =
          source === "camera"
            ? await ImagePicker.launchCameraAsync({ mediaTypes, quality: 1 })
            : await ImagePicker.launchImageLibraryAsync({ mediaTypes, quality: 1 });
      } catch (err) {
        // launchCameraAsync REJECTS when CAMERA is denied (its own native
        // ensureCameraPermissionsAreGranted), so a denial used to close the
        // sheet and do nothing at all, forever. READ the status here — don't
        // ask for it, per the comment above.
        if (source === "camera") {
          const permission = await ImagePicker.getCameraPermissionsAsync();
          if (!permission.granted) {
            alertPermissionDenied({
              title: "Camera permission needed",
              askAgainMessage: "Allow camera access to take a photo here.",
              settingsMessage:
                "The camera was previously denied. Enable it for Logjam in system settings.",
              canAskAgain: permission.canAskAgain,
            });
            return;
          }
        }
        throw err;
      }
      if (result.canceled || result.assets.length === 0) return;
      const asset = result.assets[0];
      // The gallery copy happens BEFORE the attach, and its failure is never
      // allowed to cost the attachment: the photo the user actually asked for
      // is the one going onto the canyon, and a refused media permission must
      // not take that with it (Settings → Privacy and security).
      if (source === "camera") await saveToGalleryIfWanted(asset.uri);
      await attach({
        uri: asset.uri,
        mimeType: asset.mimeType,
        fileName: asset.fileName,
      });
    },
    [attach],
  );

  const pickRouteFile = useCallback(async () => {
    const result = await DocumentPicker.getDocumentAsync({
      // Android reports .gpx/.kml inconsistently (often octet-stream), so accept
      // anything and let the extension decide.
      type: "*/*",
      copyToCacheDirectory: true,
    });
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0];
    const mimeType = routeFileMimeType(asset.name, asset.mimeType);
    if (mimeType === null) {
      fail("Pick a .gpx or .kml file.");
      return;
    }
    await attach({ uri: asset.uri, mimeType, fileName: asset.name });
  }, [attach, fail]);

  const attachRecordedTrack = useCallback(
    async (track: Track) => {
      setBusy(true);
      // A GPX of a recorded track is the densest coordinate artefact this app
      // produces — a timestamped trace of a whole descent. It is scratch: it
      // exists only until `attachMediaLocal` has copied it into media-cache/,
      // so it goes in the wiped scratch dir AND is deleted here (the GeoPDF
      // pipeline's contract, which this path never had).
      let scratch: string | null = null;
      try {
        const points = await listTrackPoints(track.id);
        if (points.length < 2) {
          fail("That track has too few points to attach.");
          return;
        }
        // Written out as GPX, the shape both clients already read: the
        // attachment shows on the web trip and on the map, and the file is one
        // the user can open anywhere. The local recording is left untouched.
        const gpx = trackPointsToGpx(track.name, points);
        scratch = await scratchFileUri(`${track.id}.gpx`);
        await FileSystem.writeAsStringAsync(scratch, gpx);
        await attachMediaLocal(linkedType, linkedId, {
          uri: scratch,
          mimeType: "application/gpx+xml",
          fileName: `${track.name}.gpx`,
        });
      } catch (err) {
        console.error(err);
        fail("That track couldn't be attached.");
      } finally {
        if (scratch) {
          await FileSystem.deleteAsync(scratch, { idempotent: true }).catch(
            console.error,
          );
        }
        setBusy(false);
      }
    },
    [fail, linkedId, linkedType],
  );

  // Loaded when the picker opens, not on mount — most visits never attach.
  useEffect(() => {
    if (sourceMode !== "tracks") return;
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
  }, [sourceMode]);

  const shown = media.filter((item) => {
    const category = mediaCategory(item.mediaType);
    return kind === "track" ? category === "track" : category === "image" || category === "video";
  });

  const confirmDelete = useCallback((item: MirrorMedia) => {
    Alert.alert("Delete this attachment?", undefined, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => void deleteMediaLocal(item).catch(console.error),
      },
    ]);
  }, []);

  const atLimit = limit != null && shown.length >= limit;

  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.row}>
          {/* The slot's panel can REPLACE what is in it, so its tile outlives
              the limit; a strip with no such panel still stops offering "Add"
              at the limit rather than failing on upload. */}
          {atLimit && !onAddWay ? null : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                kind !== "track"
                  ? "Add a photo or video"
                  : onAddWay
                    ? atLimit
                      ? "Replace this canyon's route"
                      : "Add a way"
                    : "Add a route"
              }
              onPress={() => (onAddWay ? onAddWay() : setSourceMode("sources"))}
              style={({ pressed }) => [
                styles.tile,
                styles.addTile,
                pressed && styles.addTilePressed,
              ]}
            >
              <Feather name={atLimit ? "repeat" : "plus"} size={20} color={theme.accent} />
              <Text style={styles.addTileLabel}>{atLimit ? "Replace" : "Add"}</Text>
            </Pressable>
          )}

          {shown.map((item, itemIndex) => (
            <AttachmentTile
              key={item.id}
              item={item}
              onPress={() =>
                kind === "track" && onShowRoute
                  ? onShowRoute(item)
                  : setViewerIndex(itemIndex)
              }
              onLongPress={() => confirmDelete(item)}
              online={online}
            />
          ))}

          {shown.length === 0 && emptyHint ? (
            <Text style={styles.emptyHint}>{emptyHint}</Text>
          ) : null}
          {atLimit ? (
            <Text style={styles.emptyHint}>
              {limit !== 1
                ? `This holds up to ${limit} attachments.`
                : onAddWay
                  ? "One route per canyon."
                  : "One route per canyon. Press and hold to replace it."}
            </Text>
          ) : null}
        </View>
      </ScrollView>

      <BottomSheet
        visible={sourceMode !== null}
        // The track list is a mode of this sheet, so backing out of it returns
        // to the source list rather than closing the whole thing.
        onClose={() => setSourceMode(sourceMode === "tracks" ? "sources" : null)}
        onClosed={() => {
          const job = pending;
          if (!job) return;
          setPending(null);
          // The job is a picker flow that can reject (a denied camera, a
          // document picker that failed): unhandled here, it was an unhandled
          // promise rejection and the button looked dead.
          void Promise.resolve(job()).catch((err: unknown) => {
            console.error(err);
            fail("That action didn't work. Please try again.");
          });
        }}
        title={
          sourceMode === "tracks"
            ? "Recorded tracks"
            : kind === "track"
              ? "Add a route"
              : "Add a photo or video"
        }
      >
        {sourceMode === "sources" ? (
          <View style={styles.sheetBody}>
            {kind === "media" ? (
              <>
                <Row
                  icon="camera"
                  title="Take photo"
                  onPress={() => runAfterSheet(() => captureFrom("camera", "photo"))}
                />
                <Row
                  icon="video"
                  title="Record video"
                  onPress={() => runAfterSheet(() => captureFrom("camera", "video"))}
                />
                <Row
                  icon="image"
                  title="Choose from library"
                  onPress={() => runAfterSheet(() => captureFrom("library", "photo"))}
                />
              </>
            ) : (
              <>
                <Row
                  icon="map"
                  title="Attach a route file"
                  subtitle="A .gpx or .kml from this phone"
                  onPress={() => runAfterSheet(pickRouteFile)}
                />
                <Row
                  icon="activity"
                  title="Attach a recorded track"
                  subtitle="A track you recorded in Logjam"
                  onPress={() => setSourceMode("tracks")}
                />
              </>
            )}
            {busy ? <ActivityIndicator color={theme.accent} /> : null}
          </View>
        ) : null}

        {sourceMode === "tracks" ? (
          <View style={styles.sheetBody}>
            {tracks === null ? (
              <ActivityIndicator color={theme.accent} />
            ) : tracks.length === 0 ? (
              <Text style={styles.emptyHint}>
                No finished recordings yet. Start one from the map — it will appear here once you stop it.
              </Text>
            ) : (
              <>
                <SectionHeader label={`${tracks.length} finished`} />
                {tracks.map((track) => (
                  <Row
                    key={track.id}
                    icon="activity"
                    hue={track.color}
                    title={track.name}
                    subtitle={trackSummary(track)}
                    onPress={() => void attachRecordedTrack(track)}
                  />
                ))}
              </>
            )}
            {busy ? <ActivityIndicator color={theme.accent} /> : null}
          </View>
        ) : null}
      </BottomSheet>

      {viewerIndex !== null && shown.length > 0 ? (
        <MediaViewer
          items={shown}
          startIndex={Math.min(viewerIndex, shown.length - 1)}
          onClose={() => setViewerIndex(null)}
        />
      ) : null}

    </View>
  );
}

/**
 * One attachment. Images and videos show their thumbnail; a track file has none
 * by design, so it gets a glyph tile in its assigned track colour — the colour
 * the map draws it in.
 */
function AttachmentTile({
  item,
  online,
  onPress,
  onLongPress,
}: {
  item: MirrorMedia;
  online: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const category = mediaCategory(item.mediaType);
  const hasThumb = category !== null && categoryHasThumbnail(category);
  const tint = item.color ?? theme.bonus1;
  return (
    <Pressable
      accessibilityRole="imagebutton"
      accessibilityLabel={item.filename ?? "Attachment"}
      onPress={onPress}
      onLongPress={onLongPress}
      style={styles.tileWrap}
    >
      {hasThumb && item.localThumbPath ? (
        <Image source={{ uri: item.localThumbPath }} style={styles.tile} />
      ) : (
        <View
          style={[
            styles.tile,
            styles.glyphTile,
            { backgroundColor: withAlpha(tint, 0.16), borderColor: withAlpha(tint, 0.5) },
          ]}
        >
          <Feather name={glyphFor(category)} size={22} color={tint} />
          <Text style={styles.glyphLabel} numberOfLines={2}>
            {item.filename ?? "Attachment"}
          </Text>
        </View>
      )}
      {category === "video" ? (
        <View style={styles.playBadge}>
          <Feather name="play" size={12} color={theme.textPrimary} />
        </View>
      ) : null}
      {item.syncState === "pendingUpload" ? (
        <View style={styles.pendingBadge}>
          <Text style={styles.pendingBadgeText}>
            {online ? "Uploading…" : "Waiting"}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function glyphFor(
  category: MediaCategory | null,
): React.ComponentProps<typeof Feather>["name"] {
  if (category === "track") return "map";
  if (category === "video") return "video";
  return "image";
}

function trackSummary(track: Track): string {
  const km = track.distanceM / 1000;
  const distance = km >= 1 ? `${km.toFixed(1)} km` : `${Math.round(track.distanceM)} m`;
  const minutes = Math.round(track.durationMs / 60000);
  const duration =
    minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
  return `${distance} · ${duration}`;
}

const TILE_SIZE = 96;

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing(1) },
  emptyHint: { color: theme.textMuted, fontSize: fontSize.sm, maxWidth: 200 },
  tileWrap: { position: "relative" },
  tile: {
    width: TILE_SIZE,
    height: TILE_SIZE,
    borderRadius: radius.lg,
    backgroundColor: theme.bonus2,
  },
  glyphTile: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    gap: spacing(0.25),
    padding: spacing(0.5),
  },
  glyphLabel: { color: theme.textMuted, fontSize: 10, textAlign: "center" },
  playBadge: {
    position: "absolute",
    top: spacing(0.5),
    right: spacing(0.5),
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: scrim.light,
  },
  pendingBadge: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: scrim.light,
    paddingVertical: spacing(0.25),
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
  },
  pendingBadgeText: {
    color: theme.textPrimary,
    fontSize: fontSize.xs,
    textAlign: "center",
  },
  addTile: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: withAlpha(theme.accent, 0.5),
    backgroundColor: withAlpha(theme.accent, 0.1),
    gap: spacing(0.25),
  },
  addTilePressed: { backgroundColor: withAlpha(theme.accent, 0.2) },
  addTileLabel: { color: theme.accent, fontSize: fontSize.xs, fontWeight: fontWeight.medium },
  tileLoading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: scrim.light,
    borderRadius: radius.lg,
  },
  sheetBody: { gap: spacing(1) },
  viewerBackdrop: {
    flex: 1,
    backgroundColor: scrim.photo,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing(2),
  },
  viewerImage: { width: "100%", height: "100%" },
  viewerUnavailable: {
    color: theme.textMuted,
    fontSize: fontSize.base,
    textAlign: "center",
  },
});
