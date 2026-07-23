// Canyon detail — read-only field view from the Stage 8 offline mirror. An
// inaccessible canyon never reaches the mirror, so it renders the same "not
// found" state as a nonexistent one — the API's 404-not-403 anti-oracle,
// preserved locally.
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { categoryHasThumbnail, formatCanyonGrade, mediaCategory } from "@logjam/shared";

import type { TCanyon } from "../api/types";
import { fontSize, radius, spacing, theme } from "../theme";
import { ensureDisplayCached } from "../sync/mediaCache";
import type { MirrorMedia } from "../sync/mirrorStore";
import { useMirrorCanyon, useMirrorCanyonMedia } from "../sync/useSyncQueries";
import { EmptyState, ErrorState, LoadingState } from "../ui/ScreenStates";

export function CanyonDetailScreen({ canyonId }: { canyonId: string }) {
  const query = useMirrorCanyon(canyonId);
  const media = useMirrorCanyonMedia(canyonId);

  if (query.loading) return <LoadingState />;
  if (query.error) return <ErrorState message={query.error} onRetry={query.refresh} />;
  if (!query.data) {
    return <EmptyState title="Canyon not found" hint="It may have been deleted." />;
  }

  return <CanyonDetailView canyon={query.data} media={media.data ?? []} />;
}

// Thumbnail strip (§7.3): thumbs come from the eager offline cache; tapping
// fetches the full-res lazily (cached after first view). Offline with no
// cached full-res → the viewer falls back to the thumbnail.
function MediaStrip({ media }: { media: MirrorMedia[] }) {
  const [viewer, setViewer] = useState<{ media: MirrorMedia; uri: string | null } | null>(
    null,
  );
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const openViewer = useCallback(async (item: MirrorMedia) => {
    setLoadingId(item.id);
    try {
      const displayUri = await ensureDisplayCached(item.id);
      setViewer({ media: item, uri: displayUri ?? item.localThumbPath });
    } finally {
      setLoadingId(null);
    }
  }, []);

  const thumbs = media.filter((item) => {
    const category = mediaCategory(item.mediaType);
    return category !== null && categoryHasThumbnail(category);
  });
  if (thumbs.length === 0) return null;

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
              style={styles.thumbWrap}
            >
              {item.localThumbPath ? (
                <Image source={{ uri: item.localThumbPath }} style={styles.thumb} />
              ) : (
                <View style={[styles.thumb, styles.thumbPlaceholder]}>
                  <Text style={styles.thumbPlaceholderText}>⌛</Text>
                </View>
              )}
              {loadingId === item.id ? (
                <View style={styles.thumbLoading}>
                  <ActivityIndicator color={theme.accent} />
                </View>
              ) : null}
            </Pressable>
          ))}
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

function CanyonDetailView({
  canyon,
  media,
}: {
  canyon: TCanyon;
  media: MirrorMedia[];
}) {
  const grade = formatCanyonGrade(canyon);
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.name}>{canyon.name}</Text>
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

      <MediaStrip media={media} />
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
});
