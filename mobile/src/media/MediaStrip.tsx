import { Feather } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import {
  categoryHasThumbnail,
  mediaCategory,
  trackPointsToGpx,
  type MediaCategory,
} from "@logjam/shared";

import { fontSize, fontWeight, radius, scrim, spacing, theme, withAlpha } from "../theme";
import { ensureDisplayCached } from "../sync/mediaCache";
import { attachMediaLocal, deleteMediaLocal } from "../sync/mediaUpload";
import type { MirrorMedia } from "../sync/mirrorStore";
import { listTrackPoints, listTracks, type Track } from "../tracks/tracksDb";
import { BottomSheet, Row, SectionHeader } from "../ui";

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
type SourceMode = "sources" | "tracks";

export function MediaStrip({
  linkedType,
  linkedId,
  media,
  emptyHint,
  onFailed,
}: {
  linkedType: "canyon" | "tripLog";
  linkedId: string;
  media: MirrorMedia[];
  /** Shown after the add tile when there are no attachments yet. */
  emptyHint?: string;
  /** Routed to the screen's toast channel; falls back to an Alert. */
  onFailed?: (message: string) => void;
}) {
  const [viewer, setViewer] = useState<{ media: MirrorMedia; uri: string | null } | null>(
    null,
  );
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [sourceMode, setSourceMode] = useState<SourceMode | null>(null);
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [busy, setBusy] = useState(false);

  const fail = useCallback(
    (message: string) => {
      if (onFailed) onFailed(message);
      else Alert.alert("Couldn't attach that", message);
    },
    [onFailed],
  );

  const openViewer = useCallback(async (item: MirrorMedia) => {
    setLoadingId(item.id);
    try {
      // A pendingUpload row's full-res IS the local copy; use it directly.
      const displayUri = item.localDisplayPath ?? (await ensureDisplayCached(item.id));
      setViewer({ media: item, uri: displayUri ?? item.localThumbPath });
    } finally {
      setLoadingId(null);
    }
  }, []);

  const attach = useCallback(
    async (file: { uri: string; mimeType?: string | null; fileName?: string | null }) => {
      setBusy(true);
      try {
        await attachMediaLocal(linkedType, linkedId, file);
        setSourceMode(null);
      } catch (err) {
        console.error(err);
        fail("That file couldn't be attached. Please try again.");
      } finally {
        setBusy(false);
      }
    },
    [fail, linkedId, linkedType],
  );

  const captureFrom = useCallback(
    async (source: "camera" | "library", kind: "photo" | "video") => {
      const permission =
        source === "camera"
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          source === "camera" ? "Camera access needed" : "Photo access needed",
          source === "camera"
            ? "Allow camera access to take photos and videos."
            : "Allow photo library access to attach photos and videos.",
        );
        return;
      }
      const mediaTypes: ImagePicker.MediaType[] =
        kind === "video" ? ["videos"] : source === "camera" ? ["images"] : ["images", "videos"];
      const result =
        source === "camera"
          ? await ImagePicker.launchCameraAsync({ mediaTypes, quality: 1 })
          : await ImagePicker.launchImageLibraryAsync({ mediaTypes, quality: 1 });
      if (result.canceled || result.assets.length === 0) return;
      const asset = result.assets[0];
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
    const mimeType = routeMimeType(asset.name, asset.mimeType);
    if (mimeType === null) {
      fail("Pick a .gpx or .kml file.");
      return;
    }
    await attach({ uri: asset.uri, mimeType, fileName: asset.name });
  }, [attach, fail]);

  const attachRecordedTrack = useCallback(
    async (track: Track) => {
      setBusy(true);
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
        const path = `${FileSystem.cacheDirectory}${track.id}.gpx`;
        await FileSystem.writeAsStringAsync(path, gpx);
        await attachMediaLocal(linkedType, linkedId, {
          uri: path,
          mimeType: "application/gpx+xml",
          fileName: `${track.name}.gpx`,
        });
        setSourceMode(null);
      } catch (err) {
        console.error(err);
        fail("That track couldn't be attached. Please try again.");
      } finally {
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

  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.row}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add an attachment"
            onPress={() => setSourceMode("sources")}
            style={({ pressed }) => [
              styles.tile,
              styles.addTile,
              pressed && styles.addTilePressed,
            ]}
          >
            <Feather name="plus" size={20} color={theme.accent} />
            <Text style={styles.addTileLabel}>Add</Text>
          </Pressable>

          {media.map((item) => (
            <AttachmentTile
              key={item.id}
              item={item}
              loading={loadingId === item.id}
              onPress={() => void openViewer(item)}
              onLongPress={() => confirmDelete(item)}
            />
          ))}

          {media.length === 0 && emptyHint ? (
            <Text style={styles.emptyHint}>{emptyHint}</Text>
          ) : null}
        </View>
      </ScrollView>

      <BottomSheet
        visible={sourceMode !== null}
        // The track list is a mode of this sheet, so backing out of it returns
        // to the source list rather than closing the whole thing.
        onClose={() => setSourceMode(sourceMode === "tracks" ? "sources" : null)}
        title={sourceMode === "tracks" ? "Recorded tracks" : "Add an attachment"}
      >
        {sourceMode === "sources" ? (
          <View style={styles.sheetBody}>
            <Row
              icon="camera"
              title="Take photo"
              onPress={() => void captureFrom("camera", "photo")}
            />
            <Row
              icon="video"
              title="Record video"
              onPress={() => void captureFrom("camera", "video")}
            />
            <Row
              icon="image"
              title="Choose from library"
              onPress={() => void captureFrom("library", "photo")}
            />
            <Row
              icon="map"
              title="Attach a route file"
              subtitle="A .gpx or .kml from this phone"
              onPress={() => void pickRouteFile()}
            />
            <Row
              icon="activity"
              title="Attach a recorded track"
              subtitle="A track you recorded in Logjam"
              onPress={() => setSourceMode("tracks")}
            />
            {busy ? <ActivityIndicator color={theme.accent} /> : null}
          </View>
        ) : null}

        {sourceMode === "tracks" ? (
          <View style={styles.sheetBody}>
            {tracks === null ? (
              <ActivityIndicator color={theme.accent} />
            ) : tracks.length === 0 ? (
              <Text style={styles.emptyHint}>
                No finished recordings yet. Start one from the map and it shows
                up here once you stop it.
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

      <Modal
        visible={viewer !== null}
        transparent
        animationType="fade"
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={() => setViewer(null)}
      >
        <Pressable style={styles.viewerBackdrop} onPress={() => setViewer(null)}>
          {viewer !== null && mediaCategory(viewer.media.mediaType) === "image" && viewer.uri ? (
            <Image
              source={{ uri: viewer.uri }}
              style={styles.viewerImage}
              resizeMode="contain"
            />
          ) : (
            <Text style={styles.viewerUnavailable}>{viewerFallback(viewer?.media)}</Text>
          )}
        </Pressable>
      </Modal>
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
  loading,
  onPress,
  onLongPress,
}: {
  item: MirrorMedia;
  loading: boolean;
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
          <Text style={styles.pendingBadgeText}>Uploading…</Text>
        </View>
      ) : null}
      {loading ? (
        <View style={styles.tileLoading}>
          <ActivityIndicator color={theme.accent} />
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

function viewerFallback(item: MirrorMedia | undefined): string {
  if (!item) return "";
  const category = mediaCategory(item.mediaType);
  if (category === "image") return "Full photo not downloaded — available online.";
  return `${item.filename ?? "Attachment"} — open it on the web to view.`;
}

/** Android often hands back octet-stream for .gpx/.kml, so trust the extension. */
function routeMimeType(name: string, reported?: string | null): string | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(".gpx")) return "application/gpx+xml";
  if (lower.endsWith(".kml")) return "application/vnd.google-earth.kml+xml";
  if (reported && mediaCategory(reported) === "track") return reported;
  return null;
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
