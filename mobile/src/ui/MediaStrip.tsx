import { Feather } from "@expo/vector-icons";
import { useCallback, useState } from "react";
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
import * as ImagePicker from "expo-image-picker";
import { categoryHasThumbnail, mediaCategory } from "@logjam/shared";

import { fontSize, radius, scrim, spacing, theme, withAlpha } from "../theme";
import { ensureDisplayCached } from "../sync/mediaCache";
import { attachPhotoLocal, deleteMediaLocal } from "../sync/mediaUpload";
import type { MirrorMedia } from "../sync/mirrorStore";

/**
 * Horizontal photo strip for a canyon or a trip — the one media surface, used
 * by both detail screens.
 *
 * Offline-first (§7.1/§7.3): a pendingUpload row renders immediately from its
 * local copy and carries an "Uploading…" badge; synced thumbs come from the
 * eager offline cache. Tapping fetches full-res lazily (cached after the first
 * view), long-press deletes after a confirm. Adding queues through the outbox,
 * so it works with no signal.
 *
 * PRIVACY: a trip photo is location evidence. Nothing here leaves the device
 * except through the outbox's authed upload, and the error paths carry no
 * filenames or canyon names.
 */
export function MediaStrip({
  linkedType,
  linkedId,
  media,
  emptyHint,
}: {
  linkedType: "canyon" | "tripLog";
  linkedId: string;
  media: MirrorMedia[];
  /** Shown in place of the strip's leading tiles when there are no photos. */
  emptyHint?: string;
}) {
  const [viewer, setViewer] = useState<{ media: MirrorMedia; uri: string | null } | null>(
    null,
  );
  const [loadingId, setLoadingId] = useState<string | null>(null);

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

  const captureFrom = useCallback(
    async (source: "camera" | "library") => {
      const permission =
        source === "camera"
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          source === "camera" ? "Camera access needed" : "Photo access needed",
          source === "camera"
            ? "Allow camera access to take photos."
            : "Allow photo library access to attach photos.",
        );
        return;
      }
      const result =
        source === "camera"
          ? await ImagePicker.launchCameraAsync({ quality: 1 })
          : await ImagePicker.launchImageLibraryAsync({ mediaTypes: "images", quality: 1 });
      if (result.canceled || result.assets.length === 0) return;
      const asset = result.assets[0];
      try {
        await attachPhotoLocal(linkedType, linkedId, {
          uri: asset.uri,
          mimeType: asset.mimeType,
          fileName: asset.fileName,
        });
      } catch (err) {
        console.error(err);
        Alert.alert("Couldn't attach photo", "Please try again.");
      }
    },
    [linkedId, linkedType],
  );

  const addPhoto = useCallback(() => {
    Alert.alert("Add photo", undefined, [
      { text: "Take photo", onPress: () => void captureFrom("camera") },
      { text: "Choose from library", onPress: () => void captureFrom("library") },
      { text: "Cancel", style: "cancel" },
    ]);
  }, [captureFrom]);

  const confirmDelete = useCallback((item: MirrorMedia) => {
    Alert.alert("Delete this photo?", undefined, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => void deleteMediaLocal(item).catch(console.error),
      },
    ]);
  }, []);

  const thumbs = media.filter((item) => {
    const category = mediaCategory(item.mediaType);
    return category !== null && categoryHasThumbnail(category);
  });

  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.row}>
          {thumbs.map((item) => (
            <Pressable
              key={item.id}
              accessibilityRole="imagebutton"
              accessibilityLabel="Photo"
              onPress={() => void openViewer(item)}
              onLongPress={() => confirmDelete(item)}
              style={styles.thumbWrap}
            >
              {item.localThumbPath ? (
                <Image source={{ uri: item.localThumbPath }} style={styles.thumb} />
              ) : (
                <View style={[styles.thumb, styles.thumbPlaceholder]}>
                  <Feather name="image" size={20} color={theme.textMuted} />
                </View>
              )}
              {item.syncState === "pendingUpload" ? (
                <View style={styles.pendingBadge}>
                  <Text style={styles.pendingBadgeText}>Uploading…</Text>
                </View>
              ) : null}
              {loadingId === item.id ? (
                <View style={styles.thumbLoading}>
                  <ActivityIndicator color={theme.accent} />
                </View>
              ) : null}
            </Pressable>
          ))}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add photo"
            onPress={() => void addPhoto()}
            style={({ pressed }) => [
              styles.thumb,
              styles.addTile,
              pressed && styles.addTilePressed,
            ]}
          >
            <Feather name="camera" size={20} color={theme.accent} />
            <Text style={styles.addTileLabel}>Add</Text>
          </Pressable>
          {thumbs.length === 0 && emptyHint ? (
            <Text style={styles.emptyHint}>{emptyHint}</Text>
          ) : null}
        </View>
      </ScrollView>

      <Modal
        visible={viewer !== null}
        transparent
        animationType="fade"
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={() => setViewer(null)}
      >
        <Pressable style={styles.viewerBackdrop} onPress={() => setViewer(null)}>
          {viewer?.uri ? (
            <Image
              source={{ uri: viewer.uri }}
              style={styles.viewerImage}
              resizeMode="contain"
            />
          ) : (
            <Text style={styles.viewerUnavailable}>
              Full photo not downloaded — available online.
            </Text>
          )}
        </Pressable>
      </Modal>
    </View>
  );
}

const THUMB_SIZE = 96;

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing(1) },
  emptyHint: {
    color: theme.textMuted,
    fontSize: fontSize.sm,
    maxWidth: 200,
  },
  thumbWrap: { position: "relative" },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: radius.lg,
    backgroundColor: theme.bonus2,
  },
  thumbPlaceholder: { alignItems: "center", justifyContent: "center" },
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
  addTileLabel: { color: theme.accent, fontSize: fontSize.xs },
  thumbLoading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: scrim.light,
    borderRadius: radius.lg,
  },
  viewerBackdrop: {
    flex: 1,
    backgroundColor: scrim.photo,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing(2),
  },
  viewerImage: { width: "100%", height: "100%" },
  viewerUnavailable: { color: theme.textMuted, fontSize: fontSize.base },
});
