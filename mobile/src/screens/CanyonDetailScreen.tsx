// Canyon detail — read-only field view from the Stage 8 offline mirror. An
// inaccessible canyon never reaches the mirror, so it renders the same "not
// found" state as a nonexistent one — the API's 404-not-403 anti-oracle,
// preserved locally.
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
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
import { fontSize, fontWeight, lineHeight, radius, spacing, theme } from "../theme";
import { ensureDisplayCached } from "../sync/mediaCache";
import { attachPhotoLocal, deleteMediaLocal } from "../sync/mediaUpload";
import { updateCanyonLocal } from "../sync/outbox";
import type { MirrorCanyon, MirrorMedia } from "../sync/mirrorStore";
import { useMirrorCanyon, useMirrorCanyonMedia } from "../sync/useSyncQueries";
import { BottomSheet } from "../ui/BottomSheet";
import { Button } from "../ui/Button";
import { ErrorBanner } from "../ui/ErrorBanner";
import { EntityEditForm, type EditFieldSpec } from "../ui/EntityEditForm";
import { Row } from "../ui/Row";
import { SectionHeader } from "../ui/SectionHeader";
import { EmptyState, ErrorState, LoadingState } from "../ui/ScreenStates";
import { StatGrid, type Stat } from "../ui/StatGrid";
import { StatusPill } from "../ui/StatusPill";

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
        accessibilityLabel="Edit canyon"
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.editButton, pressed && styles.editButtonPressed]}
      >
        <Feather name="edit-2" size={16} color={theme.accent} />
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
      <SectionHeader label="PHOTOS" />
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
            <Feather name="plus" size={20} color={theme.accent} />
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
//
// `openRequest` lets the top-level "Share" action tile trigger this section's
// picker sheet without lifting its load/share/unshare state out of the
// component — bump the counter and the effect below opens the sheet.
function CanyonSharingSection({
  canyonId,
  openRequest,
}: {
  canyonId: string;
  openRequest: number;
}) {
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

  // openRequest starts at 0; only act on it once it's been bumped above 0 by
  // the caller (an effect-mount value of 0 must not auto-open the sheet).
  useEffect(() => {
    if (openRequest > 0) void openPicker();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest]);

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
      <SectionHeader label="SHARED WITH" />
      {actionError ? <ErrorBanner message={actionError} /> : null}
      {recipients === null && loadError ? (
        <Text style={styles.sharingNote}>{loadError}</Text>
      ) : recipients === null ? (
        <ActivityIndicator color={theme.accent} style={styles.sharingSpinner} />
      ) : recipients.length === 0 ? (
        <Text style={styles.sharingNote}>Not shared with anyone yet.</Text>
      ) : (
        recipients.map((recipient) => (
          <Row
            key={recipient.id}
            title={recipient.sharedWith.username}
            right={
              busyId === recipient.id ? (
                <ActivityIndicator color={theme.accent} />
              ) : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Stop sharing with ${recipient.sharedWith.username}`}
                  onPress={() => confirmUnshare(recipient)}
                >
                  <StatusPill label="Unshare" tone="warning" />
                </Pressable>
              )
            }
          />
        ))
      )}

      <Button label="Share with a friend" variant="outlineAccent" onPress={() => void openPicker()} />

      <BottomSheet visible={pickerOpen} onClose={() => setPickerOpen(false)} title="Share with">
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
          <View style={styles.sheetList}>
            {shareable.map((friend) => (
              <Row
                key={friend.id}
                title={friend.username}
                onPress={busyId === null ? () => void share(friend) : undefined}
                right={busyId === friend.id ? <ActivityIndicator color={theme.accent} /> : undefined}
              />
            ))}
          </View>
        )}
      </BottomSheet>
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
  const isOwner = canyon.syncRole === "owner";
  const [shareOpenRequest, setShareOpenRequest] = useState(0);

  const navigate = useCallback(() => {
    const latitude = canyon.latitude;
    const longitude = canyon.longitude;
    const label = encodeURIComponent(canyon.name);
    const url =
      Platform.OS === "ios"
        ? `maps:0,0?q=${label}@${latitude},${longitude}`
        : `geo:${latitude},${longitude}?q=${latitude},${longitude}(${label})`;
    Linking.openURL(url).catch(() => {
      Alert.alert("Couldn't open maps", "No maps app is available on this device.");
    });
  }, [canyon.latitude, canyon.longitude, canyon.name]);

  const stats: Stat[] = [];
  if (grade) stats.push({ label: "Grade", value: grade });
  if (canyon.quality != null) stats.push({ label: "Rating", value: `${canyon.quality}/5` });
  if (canyon.numAbseils != null) {
    stats.push({ label: "Abseils", value: String(canyon.numAbseils) });
  }
  if (canyon.longestAbseil != null) {
    stats.push({ label: "Longest drop", value: `${canyon.longestAbseil} m` });
  }
  if (canyon.hours != null) stats.push({ label: "Hours", value: String(canyon.hours) });
  stats.push({
    label: "Location",
    value: `${canyon.latitude.toFixed(5)}, ${canyon.longitude.toFixed(5)}`,
  });

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <View style={styles.pillRow}>
        <StatusPill label={isOwner ? "Owned" : "Shared"} tone={isOwner ? "accent" : "outline"} />
        <StatusPill label="Downloaded" tone="accent" />
      </View>

      <View style={styles.header}>
        <Text style={[styles.name, styles.headerName]} numberOfLines={2}>
          {canyon.name}
        </Text>
        {isOwner ? <EditCanyonButton canyon={canyon} /> : null}
      </View>
      {canyon.altNames.length > 0 ? (
        <Text style={styles.altNames}>Also known as {canyon.altNames.join(", ")}</Text>
      ) : null}

      <View style={styles.actionRow}>
        <ActionTile icon="navigation" label="Navigate" tone="filled" onPress={navigate} />
        <ActionTile icon="check" label="Downloaded" tone="outline" />
        {isOwner ? (
          <ActionTile
            icon="share-2"
            label="Share"
            tone="plain"
            onPress={() => setShareOpenRequest((n) => n + 1)}
          />
        ) : null}
      </View>

      <SectionHeader label="OVERVIEW" />
      <StatGrid stats={stats} />

      {canyon.notes ? (
        <View style={styles.notesBlock}>
          <SectionHeader label="NOTES · SHARED WITH SHAREES" />
          <Text style={styles.notes}>{canyon.notes}</Text>
        </View>
      ) : null}

      <MediaStrip canyonId={canyonId} media={media} />

      {isOwner ? <CanyonSharingSection canyonId={canyonId} openRequest={shareOpenRequest} /> : null}
    </ScrollView>
  );
}

function ActionTile({
  icon,
  label,
  onPress,
  tone,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  label: string;
  onPress?: () => void;
  tone: "filled" | "outline" | "plain";
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !onPress }}
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [
        styles.actionTile,
        styles[`actionTile_${tone}`],
        pressed && onPress ? styles.actionTilePressed : null,
      ]}
    >
      <Feather name={icon} size={20} color={tone === "filled" ? theme.primary : theme.accent} />
      <Text style={[styles.actionLabel, tone === "filled" ? styles.actionLabelOnFilled : styles.actionLabelAccent]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.primary },
  content: { padding: spacing(2), gap: spacing(1) },
  pillRow: { flexDirection: "row", gap: spacing(1) },
  header: { flexDirection: "row", alignItems: "flex-start", gap: spacing(1) },
  headerName: { flex: 1 },
  editButton: {
    borderWidth: 1,
    borderColor: theme.accent,
    borderRadius: radius.sm,
    padding: spacing(1),
  },
  editButtonPressed: { backgroundColor: theme.bonus2 },
  name: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: theme.textPrimary },
  altNames: { fontSize: fontSize.sm, color: theme.textMuted },
  actionRow: { flexDirection: "row", gap: spacing(1) },
  actionTile: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    paddingVertical: spacing(1.25),
    gap: spacing(0.5),
    minHeight: 64,
  },
  actionTile_filled: { backgroundColor: theme.accent },
  actionTile_outline: { borderWidth: 1, borderColor: theme.accent },
  actionTile_plain: { borderWidth: 1, borderColor: theme.bonus2 },
  actionTilePressed: { opacity: 0.75 },
  actionLabel: { fontSize: fontSize.xs, fontWeight: fontWeight.medium },
  actionLabelOnFilled: { color: theme.primary },
  actionLabelAccent: { color: theme.accent },
  notesBlock: { gap: spacing(0.5) },
  notes: { fontSize: fontSize.base, color: theme.textPrimary, lineHeight: lineHeight.body },
  mediaBlock: { gap: spacing(0.5) },
  mediaRow: { flexDirection: "row", gap: spacing(1) },
  thumbWrap: { position: "relative" },
  thumb: {
    width: 96,
    height: 96,
    borderRadius: radius.md,
    backgroundColor: theme.bonus2,
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
  addTilePressed: { backgroundColor: theme.bonus2 },
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
  sheetList: { gap: spacing(1) },
});
