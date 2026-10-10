// Trip detail — one logbook entry. Answers "what did I do that day?": the
// date and activity up top, then the places, the photos, and the notes.
//
// Reads live from the offline mirror so an optimistic edit shows immediately,
// falling back to the navigation snapshot before the first mirror read
// resolves. Editing reuses the Logs screen's TripEditSheet — one trip form in
// the app, so the fields can't drift between "log" and "edit".
//
// PRIVACY: everything here (place names, notes, photos) is already on the
// device in the mirror. Nothing is logged, and photos leave only through the
// outbox's authed upload.
import { Fragment, useCallback, useRef, useState, type ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import {
  attributeRows,
  contractSectionKeys,
  distinctTripTypes,
  formatTripDate,
  mediaCategory,
  messageFromError,
  TRIP_PAGE,
  tripTitle,
  type SectionKeysOn,
} from "@logjam/shared";

import { useConnectivity } from "../map/connectivity";
import { useFieldDefs } from "../customFields/useFieldDefs";
import { AttributeTable } from "../customFields/CustomFieldValues";
import { MediaStrip } from "../media/MediaStrip";
import { resolveRouteAttachmentBbox } from "../media/routeAttachmentBbox";
import { fontSize, lineHeight, spacing, theme } from "../theme";
import type { MirrorTrip } from "../sync/mirrorStore";
import {
  useMirrorPlaces,
  useMirrorMedia,
  useMirrorTrip,
  useMirrorTrips,
} from "../sync/useSyncQueries";
import {
  Hero,
  IconButton,
  Row,
  SectionHeader,
  StatusPill,
  Toast,
  type ToastMessage,
  Icon,
} from "../ui";
import { TripEditSheet } from "./TripEditSheet";
import { TripOptionsSheet } from "./TripOptionsSheet";
import { primaryTripType, tripTypeLabel, tripTypeMeta } from "./tripTypeMeta";

export function TripDetailScreen({
  trip,
  onBack,
  onOpenPlace,
  onFocusOnMap,
}: {
  trip: MirrorTrip;
  onBack: () => void;
  onOpenPlace: (placeId: string, name: string) => void;
  /** Opens the Map tab framed on this route attachment's extent (resolved
   *  here, first) — nothing is drawn on the map. */
  onFocusOnMap: (bbox: [number, number, number, number]) => void;
}) {
  const live = useMirrorTrip(trip.id);
  const current = live.data ?? trip;
  const media = useMirrorMedia("tripLog", trip.id);
  const placesQuery = useMirrorPlaces();
  const allTrips = useMirrorTrips();
  const online = useConnectivity() === "online";
  // Definitions give each stored value its real label and ordering; without
  // them (offline with an account, or a field deleted since) the key is
  // un-slugged instead. A guest's come off the device, so they are always there.
  const { defs: fieldDefs } = useFieldDefs("tripLog");

  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
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
  const customFields = attributeRows(fieldDefs, current.customFields);

  const copy = TRIP_PAGE.copy;

  // Exhaustive by type: a section the contract names and this screen does not
  // draw, or the reverse, fails `tsc` (`TRIP_PAGE`, shared/src/contracts).
  const sections: Record<
    SectionKeysOn<typeof TRIP_PAGE, "gps">,
    () => ReactNode
  > = {
    // The Hero's own content, pinned above the scroll: the date is its eyebrow.
    hero: () => (
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
          <StatusPill label={copy.noType} icon={meta.icon} hue={meta.hue} />
        )}
      </View>
    ),

    places: () => (
      <>
        <SectionHeader
          title={copy.places}
          count={current.places.length || undefined}
        />
        {current.places.length === 0 ? (
          <Text style={styles.muted}>{copy.placesEmpty}</Text>
        ) : (
          current.places.map((place) => (
            <Row
              key={place.id}
              icon="place"
              hue={theme.accent}
              title={place.name}
              right={
                <Icon idea="disclosure" size={20} color={theme.textMuted} />
              }
              onPress={() => onOpenPlace(place.id, place.name)}
            />
          ))
        )}
      </>
    ),

    photos: () => (
      <>
        <SectionHeader title={copy.photos} count={photoCount || undefined} />
        <MediaStrip
          kind="media"
          online={online}
          linkedType="tripLog"
          linkedId={current.id}
          media={attachments}
          emptyHint={copy.photosEmpty}
          onFailed={(text) => notify(text, "error")}
        />
      </>
    ),

    routes: () => (
      <>
        <SectionHeader title={copy.routes} count={routeCount || undefined} />
        <MediaStrip
          kind="track"
          online={online}
          linkedType="tripLog"
          linkedId={current.id}
          media={attachments}
          emptyHint={copy.routesEmpty}
          onFailed={(text) => notify(text, "error")}
          onShowRoute={(item) => {
            resolveRouteAttachmentBbox({
              mediaId: item.id,
              filename: item.filename ?? "Route",
              localPath: item.localDisplayPath,
            })
              .then(onFocusOnMap)
              .catch((err: unknown) => {
                notify(
                  messageFromError(
                    err,
                    "Couldn't read that route file. It may not be downloaded yet.",
                  ),
                  "error",
                );
              });
          }}
        />
      </>
    ),

    notes: () => (
      <>
        <SectionHeader title={copy.notes} />
        {current.notes ? (
          <Text style={styles.notes}>{current.notes}</Text>
        ) : (
          <Text style={styles.muted}>{copy.notesEmpty}</Text>
        )}
      </>
    ),

    attributes: () =>
      customFields.length > 0 ? (
        <>
          <SectionHeader title={copy.attributes} />
          <AttributeTable rows={customFields} />
        </>
      ) : null,
  };

  return (
    <View style={styles.screen}>
      <Hero
        eyebrow={formatTripDate(current.date)}
        title={tripTitle(current)}
        titleNumberOfLines={2}
        onBack={onBack}
        actions={
          <IconButton
            icon="overflow"
            accessibilityLabel={`Actions for ${tripTitle(current)}`}
            color={theme.accent}
            filled
            onPress={() => setMenuOpen(true)}
          />
        }
      >
        {sections.hero()}
      </Hero>

      <ScrollView contentContainerStyle={styles.body}>
        {contractSectionKeys(TRIP_PAGE, "gps")
          .filter((key) => key !== "hero")
          .map((key) => (
            <Fragment key={key}>{sections[key]()}</Fragment>
          ))}
      </ScrollView>

      {/* THE PAGE'S VERBS: the sheet a row in the logbook opens too. */}
      <TripOptionsSheet
        trip={menuOpen ? current : null}
        surface="page"
        onClose={() => setMenuOpen(false)}
        onEdit={() => setEditing(true)}
        onInfo={(text) => notify(text, "info")}
        onError={(text) => notify(text, "error")}
        onGone={onBack}
      />

      <TripEditSheet
        online={online}
        visible={editing}
        trip={current}
        places={placesQuery.data ?? []}
        existingTypes={distinctTripTypes(allTrips.data ?? [])}
        onClose={() => setEditing(false)}
        onSaved={(text) => notify(text, "info")}
      />

      <Toast message={toast} onDismissed={() => setToast(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.page },
  typeRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing(0.75) },
  body: {
    paddingHorizontal: spacing(2),
    paddingBottom: spacing(4),
    gap: spacing(1),
  },
  muted: { color: theme.textMuted, fontSize: fontSize.sm },
  notes: {
    color: theme.text,
    fontSize: fontSize.base,
    lineHeight: lineHeight.body,
  },
});
