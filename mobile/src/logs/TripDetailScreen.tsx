// Trip detail — one logbook entry. Answers "what did I do that day?": the
// date and activity up top, then the canyons, the photos, and the notes.
//
// Reads live from the offline mirror so an optimistic edit shows immediately,
// falling back to the navigation snapshot before the first mirror read
// resolves. Editing reuses the Logs screen's TripEditSheet — one trip form in
// the app, so the fields can't drift between "log" and "edit".
//
// PRIVACY: everything here (canyon names, notes, photos) is already on the
// device in the mirror. Nothing is logged, and photos leave only through the
// outbox's authed upload.
import { useCallback, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import {
  customFieldDisplayLabel,
  distinctTripTypes,
  mediaCategory,
} from "@logjam/shared";

import { useConnectivity } from "../map/connectivity";
import { tripTitle } from "../api/tripTitle";
import { useFieldDefs } from "../customFields/useFieldDefs";
import { MediaStrip } from "../media/MediaStrip";
import { fontSize, fontWeight, lineHeight, radius, spacing, surface, theme } from "../theme";
import type { MirrorTrip } from "../sync/mirrorStore";
import {
  useMirrorCanyons,
  useMirrorMedia,
  useMirrorTrip,
  useMirrorTrips,
} from "../sync/useSyncQueries";
import {
  HeroHeader,
  IconButton,
  Row,
  SectionHeader,
  StatusPill,
  Toast,
  type ToastMessage,
} from "../ui";
import { formatTripDate } from "./logbook";
import { TripEditSheet } from "./TripEditSheet";
import { primaryTripType, tripTypeLabel, tripTypeMeta } from "./tripTypeMeta";

export function TripDetailScreen({
  trip,
  onBack,
  onOpenCanyon,
  onShowRoute,
}: {
  trip: MirrorTrip;
  onBack: () => void;
  onOpenCanyon: (canyonId: string, name: string) => void;
  /** Opens the Map tab with this route attachment drawn on it. */
  onShowRoute: (mediaId: string, filename: string, localPath: string | null) => void;
}) {
  const live = useMirrorTrip(trip.id);
  const current = live.data ?? trip;
  const media = useMirrorMedia("tripLog", trip.id);
  const canyonsQuery = useMirrorCanyons();
  const allTrips = useMirrorTrips();
  const online = useConnectivity() === "online";
  // Definitions give each stored value its real label and ordering; without
  // them (offline with an account, or a field deleted since) the key is
  // un-slugged instead. A guest's come off the device, so they are always there.
  const { defs: fieldDefs } = useFieldDefs("tripLog");

  const [editing, setEditing] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const toastNonce = useRef(0);
  const notify = useCallback((text: string, tone: "info" | "error") => {
    toastNonce.current += 1;
    setToast({ text, tone, nonce: toastNonce.current });
  }, []);

  const meta = tripTypeMeta(primaryTripType(current.types));
  const attachments = media.data ?? [];
  const photoCount = attachments.filter((item) => {
    const category = mediaCategory(item.mediaType);
    return category === "image" || category === "video";
  }).length;
  const routeCount = attachments.filter(
    (item) => mediaCategory(item.mediaType) === "track",
  ).length;
  const storedFields = current.customFields;
  const definedFirst = fieldDefs
    .filter((def) => storedFields[def.key] !== undefined)
    .map((def) => [customFieldDisplayLabel(def), storedFields[def.key]] as const);
  const orphaned = Object.entries(storedFields)
    .filter(([key]) => !fieldDefs.some((def) => def.key === key))
    .map(([key, value]) => [humanizeFieldKey(key), value] as const);
  const customFields = [...definedFirst, ...orphaned];

  return (
    <View style={styles.screen}>
      <HeroHeader
        eyebrow={formatTripDate(current.date)}
        title={tripTitle(current)}
        titleNumberOfLines={2}
        onBack={onBack}
        action={
          <IconButton
            icon="edit-2"
            accessibilityLabel="Edit trip"
            color={theme.accent}
            filled
            onPress={() => setEditing(true)}
          />
        }
      >
        <View style={styles.typeRow}>
          {current.types.length > 0 ? (
            current.types.map((type) => (
              <StatusPill
                key={type}
                label={tripTypeLabel(type)}
                icon={tripTypeMeta(type).icon}
                hue={tripTypeMeta(type).hue}
              />
            ))
          ) : (
            <StatusPill label="No type set" icon={meta.icon} hue={meta.hue} />
          )}
        </View>
      </HeroHeader>

      <ScrollView contentContainerStyle={styles.body}>
        <SectionHeader
          label={
            current.canyons.length === 1
              ? "Canyon"
              : `Canyons · ${current.canyons.length}`
          }
        />
        {current.canyons.length === 0 ? (
          <Text style={styles.muted}>
            No canyons linked. Edit the trip to link one from your library.
          </Text>
        ) : (
          current.canyons.map((canyon) => (
            <Row
              key={canyon.id}
              icon="map-pin"
              hue={theme.accent}
              title={canyon.name}
              right={<Feather name="chevron-right" size={20} color={theme.textMuted} />}
              onPress={() => onOpenCanyon(canyon.id, canyon.name)}
            />
          ))
        )}

        <SectionHeader
          label={photoCount === 0 ? "Photos & videos" : `Photos & videos · ${photoCount}`}
        />
        <MediaStrip
          kind="media"
          online={online}
          linkedType="tripLog"
          linkedId={current.id}
          media={attachments}
          emptyHint="No photos or videos yet."
          onFailed={(text) => notify(text, "error")}
        />

        <SectionHeader label={routeCount === 0 ? "Routes" : `Routes · ${routeCount}`} />
        <MediaStrip
          kind="track"
          online={online}
          linkedType="tripLog"
          linkedId={current.id}
          media={attachments}
          emptyHint="Attach a .gpx or .kml."
          onFailed={(text) => notify(text, "error")}
          onShowRoute={(item) =>
            onShowRoute(item.id, item.filename ?? "Route", item.localDisplayPath)
          }
        />

        <SectionHeader label="Notes" />
        {current.notes ? (
          <Text style={styles.notes}>{current.notes}</Text>
        ) : (
          <Text style={styles.muted}>Nothing written down.</Text>
        )}

        {customFields.length > 0 ? (
          <>
            <SectionHeader label="Your fields" />
            <View style={styles.fieldCard}>
              {customFields.map(([label, value]) => (
                <View key={label} style={styles.fieldRow}>
                  <Text style={styles.fieldKey}>{label}</Text>
                  <Text style={styles.fieldValue}>{formatFieldValue(value)}</Text>
                </View>
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>

      <TripEditSheet
        online={online}
        visible={editing}
        trip={current}
        canyons={canyonsQuery.data ?? []}
        existingTypes={distinctTripTypes(allTrips.data ?? [])}
        onClose={() => setEditing(false)}
        onSaved={(text) => notify(text, "info")}
        onFailed={(text) => notify(text, "error")}
      />

      <Toast message={toast} onDismissed={() => setToast(null)} />
    </View>
  );
}

/**
 * Fallback label for a value whose DEFINITION is gone — deleted on another
 * device, or not loaded because we are offline. Keys are slugs of the original
 * label (`makeCustomFieldKey`), so un-slugging beats showing `water_level` raw.
 */
function humanizeFieldKey(key: string): string {
  const spaced = key.replace(/[_-]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function formatFieldValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.primary },
  typeRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing(0.75) },
  body: {
    paddingHorizontal: spacing(2),
    paddingBottom: spacing(4),
    gap: spacing(1),
  },
  muted: { color: theme.textMuted, fontSize: fontSize.sm },
  notes: {
    color: theme.textPrimary,
    fontSize: fontSize.base,
    lineHeight: lineHeight.body,
  },
  fieldCard: {
    backgroundColor: surface.card,
    borderWidth: 1,
    borderColor: surface.border,
    borderRadius: radius.lg,
    padding: spacing(1.5),
    gap: spacing(1),
  },
  fieldRow: { flexDirection: "row", justifyContent: "space-between", gap: spacing(2) },
  fieldKey: { color: theme.textMuted, fontSize: fontSize.sm, flexShrink: 1 },
  fieldValue: {
    color: theme.textPrimary,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    textAlign: "right",
    flexShrink: 1,
  },
});
