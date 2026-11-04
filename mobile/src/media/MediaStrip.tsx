import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import {
  attachSummary,
  categoryHasThumbnail,
  mediaCategory,
  type MediaCategory,
} from "@logjam/shared";

import {
  radius,
  ON_SCRIM,
  scrim,
  spacing,
  withAlpha,
  makeStyles,
  useTheme,
  muted,
} from "../theme";
import {
  attachMediaLocal,
  deleteMediaLocal,
  type PickedFile,
} from "../sync/mediaUpload";
import { attachRecordedTrack } from "../tracks/attachRecordedTrack";
import type { MirrorMedia } from "../sync/mirrorStore";
import { pickMedia } from "./pickMedia";
import { attachBatch } from "./attachBatch";
import { stripOffers } from "./stripOffers";
import { routeFileMimeType } from "./routeFileMime";
import { listTracks, type Track } from "../tracks/tracksDb";
import {
  BottomSheet,
  confirm,
  Row,
  SectionHeader,
  Icon,
  type Glyph,
} from "../ui";
import { MediaViewer } from "./MediaViewer";

/**
 * Attachment strip for a place or a trip — the one media surface, used by both
 * detail screens.
 *
 * Not in `src/ui`: it owns picker permissions, file copying and outbox writes,
 * so it is a feature component that happens to be shared, not a kit primitive.
 *
 * Offline-first: a pendingUpload row renders immediately from its
 * local copy and carries an "Uploading…" badge; synced thumbs come from the
 * eager offline cache. Tapping opens it, long-press deletes after a confirm.
 * Adding queues through the outbox, so every source works with no signal.
 *
 * Sources live in a sheet rather than an Alert: there are five, they need
 * glyphs, one needs a sub-step (which recorded track), and Android's Alert caps
 * at three buttons (a sheet avoids the button count ceiling).
 *
 * PRIVACY: a photo is location evidence and a recorded track IS precise
 * location history. Nothing here leaves the device except through the outbox's
 * authed upload; the error paths carry no filenames, place names or
 * coordinates. Guard: mobile/src/sentry/scrubEvent.test.ts.
 */

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
  onAdded,
  onShowRoute,
  onAddWay,
  readOnly,
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
  linkedType: "place" | "tripLog";
  linkedId: string;
  /** All attachments for the row; this strip shows only its own `kind`. */
  media: MirrorMedia[];
  /** Shown after the add tile when there are no attachments yet. */
  emptyHint?: string;
  /**
   * How many attachments this strip accepts. At the limit the add tile is
   * replaced by a line saying so, rather than left there to fail on upload.
   *
   * A place takes exactly ONE route: the API rejects a second with 409 "This
   * place already has a track" (`api/src/routes/media.ts`), and a rejected
   * upload would sit in the outbox as a dead push. Photos are uncapped.
   */
  limit?: number;
  /** Routed to the screen's toast channel. */
  onFailed: (message: string) => void;
  /** Routed to the same channel, for the one line a successful pick leaves. */
  onAdded: (message: string) => void;
  /**
   * Show a route attachment on the map. Given for `kind="track"`, a tap opens
   * the map rather than the viewer — a line on a basemap is the only useful way
   * to read a GPX, and a full-screen "open it elsewhere" page is a dead end.
   */
  onShowRoute?: (item: MirrorMedia) => void;
  /**
   * The place route slot's own panel ("Add a way"), owned by the place screen
   * — a place's slot can be filled five ways, three of which are not media at
   * all, so this strip does not try to offer them. Given, the add tile opens
   * that panel instead of this component's own source sheet, and the tile
   * survives the limit as "Replace". A TRIP has no slot and no limit, passes
   * nothing, and keeps the two file sources below.
   */
  onAddWay?: () => void;
  /** Someone else owns the row: no Add, no press-and-hold delete. */
  readOnly?: boolean;
}) {
  const theme = useTheme();
  const styles = useStyles();

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
  const [pending, setPending] = useState<null | (() => void | Promise<void>)>(
    null,
  );
  const runAfterSheet = useCallback((job: () => void | Promise<void>) => {
    setPending(() => job);
    setSourceMode(null);
  }, []);

  const attach = useCallback(
    async (files: PickedFile[]) => {
      setBusy(true);
      try {
        const { added, failed } = await attachBatch(files, (file) =>
          attachMediaLocal(linkedType, linkedId, file),
        );
        const summary = attachSummary(
          added.map((file) => mediaCategory(file.mimeType ?? "image/jpeg")),
          failed,
        );
        if (summary?.tone === "error") onFailed(summary.message);
        else if (summary) onAdded(summary.message);
      } finally {
        setBusy(false);
      }
    },
    [onAdded, onFailed, linkedId, linkedType],
  );

  const captureFrom = useCallback(
    async (source: "camera" | "library", kind: "photo" | "video") => {
      const files = await pickMedia(source, kind);
      if (files.length > 0) await attach(files);
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
      onFailed("Pick a .gpx or .kml file.");
      return;
    }
    await attach([{ uri: asset.uri, mimeType, fileName: asset.name }]);
  }, [attach, onFailed]);

  const attachTrack = useCallback(
    async (track: Track) => {
      setBusy(true);
      try {
        if (await attachRecordedTrack(linkedType, linkedId, track))
          onAdded("1 route added.");
        else onFailed("That track has too few points to attach.");
      } catch (err) {
        console.error(err);
        onFailed("That track couldn't be attached.");
      } finally {
        setBusy(false);
      }
    },
    [onAdded, onFailed, linkedId, linkedType],
  );

  // Loaded when the picker opens, not on mount — most visits never attach.
  useEffect(() => {
    if (sourceMode !== "tracks") return;
    let cancelled = false;
    listTracks()
      .then((all) => {
        if (!cancelled)
          setTracks(all.filter((track) => track.state === "done"));
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
    return kind === "track"
      ? category === "track"
      : category === "image" || category === "video";
  });

  const confirmDelete = useCallback(async (item: MirrorMedia) => {
    if (
      await confirm({
        confirmTitle: "Delete this attachment?",
        confirmBody:
          "It goes from your account and your other devices. This can't be undone.",
        confirmLabel: "Delete",
        tone: "destructive",
      })
    )
      void deleteMediaLocal(item).catch(console.error);
  }, []);

  const atLimit = limit != null && shown.length >= limit;
  const offers = stripOffers({ readOnly, atLimit, hasAddWay: !!onAddWay });

  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.row}>
          {/* The slot's panel can REPLACE what is in it, so its tile outlives
              the limit; a strip with no such panel still stops offering "Add"
              at the limit rather than failing on upload. */}
          {offers.add ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                kind !== "track"
                  ? "Add a photo or video"
                  : onAddWay
                    ? atLimit
                      ? "Replace this place's route"
                      : "Add a way"
                    : "Add a route"
              }
              accessibilityState={{ busy }}
              // A second batch would run beside the first.
              onPress={() => {
                if (busy) return;
                if (onAddWay) onAddWay();
                else setSourceMode("sources");
              }}
              style={({ pressed }) => [
                styles.tile,
                styles.addTile,
                pressed && styles.addTilePressed,
              ]}
            >
              {busy ? (
                <ActivityIndicator color={theme.accent} />
              ) : (
                <Icon
                  idea={atLimit ? "replace" : "add"}
                  size={20}
                  color={theme.accent}
                />
              )}
              <Text style={styles.addTileLabel}>
                {busy ? "Adding…" : atLimit ? "Replace" : "Add"}
              </Text>
            </Pressable>
          ) : null}

          {shown.map((item, itemIndex) => (
            <AttachmentTile
              key={item.id}
              item={item}
              onPress={() =>
                kind === "track" && onShowRoute
                  ? onShowRoute(item)
                  : setViewerIndex(itemIndex)
              }
              onLongPress={
                offers.remove ? () => void confirmDelete(item) : undefined
              }
              online={online}
            />
          ))}

          {shown.length === 0 && emptyHint ? (
            <Text style={styles.emptyHint}>{emptyHint}</Text>
          ) : null}
          {atLimit && !readOnly ? (
            <Text style={styles.emptyHint}>
              {limit !== 1
                ? `This holds up to ${limit} attachments.`
                : onAddWay
                  ? "One route per place."
                  : "One route per place. Press and hold to replace it."}
            </Text>
          ) : null}
        </View>
      </ScrollView>

      <BottomSheet
        visible={sourceMode !== null}
        // The track list is a mode of this sheet, so backing out of it returns
        // to the source list rather than closing the whole thing.
        onClose={() =>
          setSourceMode(sourceMode === "tracks" ? "sources" : null)
        }
        onClosed={() => {
          const job = pending;
          if (!job) return;
          setPending(null);
          // The job is a picker flow that can reject (a denied camera, a
          // document picker that failed): unhandled, a rejection would leave
          // the button unresponsive.
          void Promise.resolve(job()).catch((err: unknown) => {
            console.error(err);
            onFailed("That action didn't work. Please try again.");
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
                  onPress={() =>
                    runAfterSheet(() => captureFrom("camera", "photo"))
                  }
                />
                <Row
                  icon="video"
                  title="Record video"
                  onPress={() =>
                    runAfterSheet(() => captureFrom("camera", "video"))
                  }
                />
                <Row
                  icon="photo"
                  title="Choose from library"
                  onPress={() =>
                    runAfterSheet(() => captureFrom("library", "photo"))
                  }
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
                  icon="track"
                  title="Attach a recorded track"
                  subtitle="A track you recorded in Logjam GPS"
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
                No finished recordings yet. Start one from the map — it will
                appear here once you stop it.
              </Text>
            ) : (
              <>
                <SectionHeader title={`${tracks.length} finished`} />
                {tracks.map((track) => (
                  <Row
                    key={track.id}
                    icon="track"
                    hue={track.color}
                    title={track.name}
                    subtitle={trackSummary(track)}
                    onPress={() => void attachTrack(track)}
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
  onLongPress?: () => void;
}) {
  const theme = useTheme();
  const styles = useStyles();

  const category = mediaCategory(item.mediaType);
  const hasThumb = category !== null && categoryHasThumbnail(category);
  const tint = item.color ?? theme.neutral;
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
            {
              backgroundColor: withAlpha(tint, 0.16),
              borderColor: withAlpha(tint, 0.5),
            },
          ]}
        >
          <Icon idea={glyphFor(category)} size={22} color={tint} />
          <Text style={styles.glyphLabel} numberOfLines={2}>
            {item.filename ?? "Attachment"}
          </Text>
        </View>
      )}
      {category === "video" ? (
        <View style={styles.playBadge}>
          <Icon idea="play" size={12} color={ON_SCRIM} />
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

function glyphFor(category: MediaCategory | null): Glyph {
  if (category === "track") return "route";
  if (category === "video") return "video";
  return "photo";
}

function trackSummary(track: Track): string {
  const km = track.distanceM / 1000;
  const distance =
    km >= 1 ? `${km.toFixed(1)} km` : `${Math.round(track.distanceM)} m`;
  const minutes = Math.round(track.durationMs / 60000);
  const duration =
    minutes >= 60
      ? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
      : `${minutes}m`;
  return `${distance} · ${duration}`;
}

const TILE_SIZE = 96;

const useStyles = makeStyles((theme, textRole) => ({
  row: { flexDirection: "row", alignItems: "center", gap: spacing(1) },
  emptyHint: { ...muted(theme, textRole.detail), maxWidth: 200 },
  tileWrap: { position: "relative" },
  tile: {
    width: TILE_SIZE,
    height: TILE_SIZE,
    borderRadius: radius.lg,
    backgroundColor: theme.card,
  },
  glyphTile: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    gap: spacing(0.25),
    padding: spacing(0.5),
  },
  glyphLabel: { ...muted(theme, textRole.meta), textAlign: "center" },
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
    backgroundColor: scrim.heavy,
    paddingVertical: spacing(0.25),
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
  },
  // Words on a scrim are white in every scheme (shared/DESIGN.md §7).
  pendingBadgeText: {
    ...textRole.caption,
    color: ON_SCRIM,
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
  addTileLabel: { ...textRole.caption, color: theme.accent },
  tileLoading: {
    ...StyleSheet.absoluteFill,
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
    ...textRole.body,
    color: theme.textMuted,
    textAlign: "center",
  },
}));
