// Canyon detail — read-only field view from the Stage 8 offline mirror. An
// inaccessible canyon never reaches the mirror, so it renders the same "not
// found" state as a nonexistent one — the API's 404-not-403 anti-oracle,
// preserved locally.
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
import * as ImagePicker from "expo-image-picker";
import {
  categoryHasThumbnail,
  formatCanyonGrade,
  mediaCategory,
  messageFromError,
} from "@logjam/shared";

import {
  getCanyonShares,
  getFriends,
  shareCanyon,
  unshareCanyon,
  type CanyonShareRecipient,
  type Friend,
} from "../api/friends";
import { fontSize, radius, spacing, theme } from "../theme";
import { ensureDisplayCached } from "../sync/mediaCache";
import { attachPhotoLocal, deleteMediaLocal } from "../sync/mediaUpload";
import { updateCanyonLocal } from "../sync/outbox";
import type { MirrorCanyon, MirrorMedia } from "../sync/mirrorStore";
import { useMirrorCanyon, useMirrorCanyonMedia } from "../sync/useSyncQueries";
import { Button } from "../ui/Button";
import { ErrorBanner } from "../ui/ErrorBanner";
import { EntityEditForm, type EditFieldSpec } from "../ui/EntityEditForm";
import { EmptyState, ErrorState, LoadingState } from "../ui/ScreenStates";

export function CanyonDetailScreen({ canyonId }: { canyonId: string }) {
  const query = useMirrorCanyon(canyonId);
  const media = useMirrorCanyonMedia(canyonId);

  if (query.loading) return <LoadingState />;
  if (query.error) return <ErrorState message={query.error} onRetry={query.refresh} />;
  if (!query.data) {
    return <EmptyState title="Canyon not found" hint="It may have been deleted." />;
  }

  return (
    <CanyonDetailView
      canyon={query.data}
      canyonId={canyonId}
      media={media.data ?? []}
    />
  );
}

// Owner-only edit (§8.2): a shared canyon's update would 404 server-side and
// park deadRemote, so the button shows for owned rows only. The form enqueues
// changed fields through the outbox; the mirror updates optimistically.
function EditCanyonButton({ canyon }: { canyon: MirrorCanyon }) {
  const [open, setOpen] = useState(false);
  const fields: EditFieldSpec[] = [
    { key: "name", label: "Name", kind: "text", value: canyon.name, required: true },
    { key: "quality", label: "Quality (0–5)", kind: "number", value: canyon.quality },
    { key: "numAbseils", label: "Abseils", kind: "number", value: canyon.numAbseils, integer: true },
    { key: "longestAbseil", label: "Longest abseil (m)", kind: "number", value: canyon.longestAbseil },
    { key: "vGrade", label: "V grade", kind: "number", value: canyon.vGrade, integer: true },
    { key: "aGrade", label: "A grade", kind: "number", value: canyon.aGrade, integer: true },
    { key: "commitment", label: "Commitment", kind: "number", value: canyon.commitment, integer: true },
    { key: "hours", label: "Hours", kind: "number", value: canyon.hours },
    { key: "notes", label: "Notes", kind: "multiline", value: canyon.notes },
  ];
  return (
    <>
      <Pressable
        accessibilityRole="button"
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.editButton, pressed && styles.editButtonPressed]}
      >
        <Text style={styles.editButtonText}>Edit</Text>
      </Pressable>
      <EntityEditForm
        visible={open}
        title="Edit canyon"
        fields={fields}
        onCancel={() => setOpen(false)}
        onSave={(changed) => updateCanyonLocal(canyon.id, changed)}
      />
    </>
  );
}

// Thumbnail strip (§7.1/§7.3): pendingUpload rows show immediately from
// their local copy; synced thumbs come from the eager offline cache. Tapping
// fetches the full-res lazily (cached after first view); long-press deletes.
// The "Add photo" button picks from the library and queues the upload
// through the outbox — works offline.
function MediaStrip({
  canyonId,
  media,
}: {
  canyonId: string;
  media: MirrorMedia[];
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
        await attachPhotoLocal("canyon", canyonId, {
          uri: asset.uri,
          mimeType: asset.mimeType,
          fileName: asset.fileName,
        });
      } catch (err) {
        console.error(err);
        Alert.alert("Couldn't attach photo", "Please try again.");
      }
    },
    [canyonId],
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
    <View style={styles.mediaBlock}>
      <Text style={styles.sectionLabel}>Photos</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.mediaRow}>
          {thumbs.map((item) => (
            <Pressable
              key={item.id}
              accessibilityRole="imagebutton"
              onPress={() => void openViewer(item)}
              onLongPress={() => confirmDelete(item)}
              style={styles.thumbWrap}
            >
              {item.localThumbPath ? (
                <Image source={{ uri: item.localThumbPath }} style={styles.thumb} />
              ) : (
                <View style={[styles.thumb, styles.thumbPlaceholder]}>
                  <Text style={styles.thumbPlaceholderText}>⌛</Text>
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
            onPress={() => void addPhoto()}
            style={({ pressed }) => [
              styles.thumb,
              styles.addTile,
              pressed && styles.addTilePressed,
            ]}
          >
            <Text style={styles.addTilePlus}>＋</Text>
            <Text style={styles.addTileLabel}>Add photo</Text>
          </Pressable>
        </View>
      </ScrollView>

      <Modal
        visible={viewer !== null}
        transparent
        animationType="fade"
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

// Per-canyon sharing (§ canyon-share hybrid model) — owner-only. Online-only:
// the grant/revoke actions hit REST directly (managing shares is not a field
// use case); the resulting record + tombstone still propagate to the sharee's
// mirror on their next pull. A sharee never sees this — the caller gates on
// syncRole === "owner". Recipients + friend picker are username-only.
function CanyonSharingSection({ canyonId }: { canyonId: string }) {
  const [recipients, setRecipients] = useState<CanyonShareRecipient[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [friends, setFriends] = useState<Friend[] | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await getCanyonShares(canyonId);
      setRecipients(next);
      setLoadError(null);
    } catch (err) {
      console.error(err);
      // Detail renders offline; sharing needs the network. Degrade to a note
      // rather than a hard error — never block the read view over it.
      setLoadError(messageFromError(err, "Sharing is unavailable offline."));
    }
  }, [canyonId]);

  useEffect(() => {
    load();
  }, [load]);

  const openPicker = useCallback(async () => {
    setActionError(null);
    setPickerOpen(true);
    if (friends === null) {
      try {
        setFriends(await getFriends());
      } catch (err) {
        setActionError(messageFromError(err, "Couldn't load friends."));
      }
    }
  }, [friends]);

  const share = useCallback(
    async (friend: Friend) => {
      setBusyId(friend.id);
      setActionError(null);
      try {
        await shareCanyon(canyonId, friend.id);
        await load();
        setPickerOpen(false);
      } catch (err) {
        setActionError(messageFromError(err, "Couldn't share canyon."));
      } finally {
        setBusyId(null);
      }
    },
    [canyonId, load],
  );

  const confirmUnshare = useCallback(
    (recipient: CanyonShareRecipient) => {
      Alert.alert(
        `Stop sharing with ${recipient.sharedWith.username}?`,
        "They'll lose access to this canyon and its photos.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Unshare",
            style: "destructive",
            onPress: () => {
              setBusyId(recipient.id);
              setActionError(null);
              unshareCanyon(canyonId, recipient.sharedWith.id)
                .then(() => load())
                .catch((err: unknown) =>
                  setActionError(messageFromError(err, "Couldn't unshare canyon.")),
                )
                .finally(() => setBusyId(null));
            },
          },
        ],
      );
    },
    [canyonId, load],
  );

  const sharedIds = new Set((recipients ?? []).map((r) => r.sharedWith.id));
  const shareable = (friends ?? []).filter((f) => !sharedIds.has(f.id));

  return (
    <View style={styles.sharingBlock}>
      <Text style={styles.sectionLabel}>Shared with</Text>
      {actionError ? <ErrorBanner message={actionError} /> : null}
      {recipients === null && loadError ? (
        <Text style={styles.sharingNote}>{loadError}</Text>
      ) : recipients === null ? (
        <ActivityIndicator color={theme.accent} style={styles.sharingSpinner} />
      ) : recipients.length === 0 ? (
        <Text style={styles.sharingNote}>Not shared with anyone yet.</Text>
      ) : (
        recipients.map((recipient) => (
          <View key={recipient.id} style={styles.shareRow}>
            <Text style={styles.shareName}>{recipient.sharedWith.username}</Text>
            {busyId === recipient.id ? (
              <ActivityIndicator color={theme.accent} />
            ) : (
              <Pressable
                accessibilityRole="button"
                onPress={() => confirmUnshare(recipient)}
                style={({ pressed }) => [styles.unsharePill, pressed && styles.addTilePressed]}
              >
                <Text style={styles.unshareText}>Unshare</Text>
              </Pressable>
            )}
          </View>
        ))
      )}

      <Button label="Share with a friend" variant="outlineAccent" onPress={() => void openPicker()} />

      <Modal
        visible={pickerOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setPickerOpen(false)}
      >
        <Pressable style={styles.pickerBackdrop} onPress={() => setPickerOpen(false)}>
          <Pressable style={styles.pickerSheet} onPress={() => {}}>
            <Text style={styles.pickerTitle}>Share with</Text>
            {actionError ? <ErrorBanner message={actionError} /> : null}
            {friends === null ? (
              <ActivityIndicator color={theme.accent} style={styles.sharingSpinner} />
            ) : shareable.length === 0 ? (
              <Text style={styles.sharingNote}>
                {friends.length === 0
                  ? "No friends yet — add friends from the Account tab."
                  : "All your friends already have access."}
              </Text>
            ) : (
              <ScrollView>
                {shareable.map((friend) => (
                  <Pressable
                    key={friend.id}
                    accessibilityRole="button"
                    onPress={() => void share(friend)}
                    disabled={busyId !== null}
                    style={({ pressed }) => [styles.shareRow, pressed && styles.addTilePressed]}
                  >
                    <Text style={styles.shareName}>{friend.username}</Text>
                    {busyId === friend.id ? <ActivityIndicator color={theme.accent} /> : null}
                  </Pressable>
                ))}
              </ScrollView>
            )}
            <Button label="Close" variant="ghost" onPress={() => setPickerOpen(false)} />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function CanyonDetailView({
  canyon,
  canyonId,
  media,
}: {
  canyon: MirrorCanyon;
  canyonId: string;
  media: MirrorMedia[];
}) {
  const grade = formatCanyonGrade(canyon);
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={[styles.name, styles.headerName]}>{canyon.name}</Text>
        {canyon.syncRole === "owner" ? <EditCanyonButton canyon={canyon} /> : null}
      </View>
      {canyon.altNames.length > 0 ? (
        <Text style={styles.altNames}>Also known as {canyon.altNames.join(", ")}</Text>
      ) : null}

      <View style={styles.fieldGrid}>
        {grade ? <Field label="Grade" value={grade} /> : null}
        {canyon.quality != null ? <Field label="Quality" value={`${canyon.quality}/5`} /> : null}
        {canyon.numAbseils != null ? <Field label="Abseils" value={String(canyon.numAbseils)} /> : null}
        {canyon.longestAbseil != null ? (
          <Field label="Longest abseil" value={`${canyon.longestAbseil} m`} />
        ) : null}
        {canyon.hours != null ? <Field label="Hours" value={String(canyon.hours)} /> : null}
        <Field
          label="Location"
          value={`${canyon.latitude.toFixed(5)}, ${canyon.longitude.toFixed(5)}`}
        />
      </View>

      {canyon.notes ? (
        <View style={styles.notesBlock}>
          <Text style={styles.sectionLabel}>Notes</Text>
          <Text style={styles.notes}>{canyon.notes}</Text>
        </View>
      ) : null}

      <MediaStrip canyonId={canyonId} media={media} />

      {canyon.syncRole === "owner" ? <CanyonSharingSection canyonId={canyonId} /> : null}
    </ScrollView>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.primary },
  content: { padding: spacing(2), gap: spacing(2) },
  header: { flexDirection: "row", alignItems: "flex-start", gap: spacing(1) },
  headerName: { flex: 1 },
  editButton: {
    borderWidth: 1,
    borderColor: theme.accent,
    borderRadius: radius.sm,
    paddingHorizontal: spacing(1.5),
    paddingVertical: spacing(0.5),
  },
  editButtonPressed: { backgroundColor: "rgba(255,255,255,0.08)" },
  editButtonText: { color: theme.accent, fontSize: fontSize.sm, fontWeight: "600" },
  name: { fontSize: fontSize.xl, fontWeight: "700", color: theme.textPrimary },
  altNames: { fontSize: fontSize.sm, color: theme.textMuted },
  fieldGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing(1) },
  field: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: radius.md,
    padding: spacing(1.5),
    minWidth: "45%",
    flexGrow: 1,
    gap: spacing(0.25),
  },
  fieldLabel: {
    fontSize: fontSize.xs,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    color: theme.textMuted,
  },
  fieldValue: { fontSize: fontSize.base, color: theme.textPrimary },
  notesBlock: { gap: spacing(0.5) },
  sectionLabel: {
    fontSize: fontSize.xs,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    color: theme.textMuted,
  },
  notes: { fontSize: fontSize.base, color: theme.textPrimary, lineHeight: 22 },
  mediaBlock: { gap: spacing(0.5) },
  mediaRow: { flexDirection: "row", gap: spacing(1) },
  thumbWrap: { position: "relative" },
  thumb: {
    width: 96,
    height: 96,
    borderRadius: radius.md,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  thumbPlaceholder: { alignItems: "center", justifyContent: "center" },
  thumbPlaceholderText: { fontSize: fontSize.xl, color: theme.textMuted },
  pendingBadge: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingVertical: spacing(0.25),
    borderBottomLeftRadius: radius.md,
    borderBottomRightRadius: radius.md,
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
    borderColor: theme.accent,
    gap: spacing(0.25),
  },
  addTilePressed: { backgroundColor: "rgba(255,255,255,0.08)" },
  addTilePlus: { color: theme.accent, fontSize: fontSize.xl },
  addTileLabel: { color: theme.accent, fontSize: fontSize.xs },
  thumbLoading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.4)",
    borderRadius: radius.md,
  },
  viewerBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.92)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing(2),
  },
  viewerImage: { width: "100%", height: "100%" },
  viewerUnavailable: { color: theme.textMuted, fontSize: fontSize.base },
  sharingBlock: { gap: spacing(1) },
  sharingNote: { color: theme.textMuted, fontSize: fontSize.sm },
  sharingSpinner: { alignSelf: "flex-start" },
  shareRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: radius.md,
    padding: spacing(1.5),
    gap: spacing(1),
  },
  shareName: { flex: 1, color: theme.textPrimary, fontSize: fontSize.base },
  unsharePill: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    borderRadius: radius.sm,
    paddingHorizontal: spacing(1.5),
    paddingVertical: spacing(0.75),
  },
  unshareText: { color: theme.warning, fontSize: fontSize.sm, fontWeight: "600" },
  pickerBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  pickerSheet: {
    backgroundColor: theme.secondary,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing(2),
    gap: spacing(1),
    maxHeight: "70%",
  },
  pickerTitle: { color: theme.textPrimary, fontSize: fontSize.lg, fontWeight: "700" },
});
