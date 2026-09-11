// Place detail — "what am I walking into?" (DESIGN.md §1). The grade, the
// numbers that decide the day, and the notes come first; sharing and admin sit
// below them, because you read this screen at a trailhead and manage it at home.
//
// Reads live from the offline mirror, so an optimistic edit shows immediately.
// An inaccessible place never reaches the mirror, so it renders the same "not
// found" state as a nonexistent one — the API's 404-not-403 anti-oracle,
// preserved locally.
//
// PRIVACY: this is the one screen that does show a coordinate, because it is the
// answer to its own question and the user asked for this place by name. It
// stays here — never on a list row (DESIGN.md §11). Sharing is owner-only and
// username-only; recipients never see this section at all.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Clipboard,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import {
  isReservedFieldKey,
  userFieldValues,
  distinctTripTypes,
  formatCanyonGrade,
  formatDistanceM,
  mediaCategory,
  messageFromError,
  removeShareConfirm,
  routeLengthM,
} from "@logjam/shared";

import { tripTitle } from "../api/tripTitle";
import {
  RecipientRows,
  shareRowSubtitle,
  SharingError,
} from "../sharing/useSharing";
import { useSharePanel, useShareRowProps } from "../sharing/SharePanel";
import { removeSharedPlace } from "../sharing/removeShare";
import { useFieldDefs } from "../customFields/useFieldDefs";
import { ATTRIBUTE_NOUN } from "../customFields/CustomFieldsEditor";
import { useConnectivity } from "../map/connectivity";
import { MediaStrip } from "../media/MediaStrip";
import { resolveRouteAttachmentBbox } from "../media/routeAttachmentBbox";
import { AddWaySheet } from "./AddWaySheet";
import {
  assetHue,
  fontSize,
  fontWeight,
  lineHeight,
  spacing,
  surface,
  theme,
} from "../theme";
import type { MirrorPlace, MirrorTrip } from "../sync/mirrorStore";
import {
  createPlaceLinkLocal,
  deletePlaceLinkLocal,
  deletePlaceLocal,
  updateRouteLocal,
} from "../sync/outbox";
import { resolveForeignField, type ForeignFieldAction } from "../api/foreignFields";
import { linkablePlaces, truncationHint } from "./linkablePlaces";
import {
  useMirrorPlace,
  useMirrorPlaces,
  useMirrorMedia,
  useMirrorRoutes,
  useMirrorPlaceLinks,
  useMirrorPlaceTypes,
  useMirrorTrips,
} from "../sync/useSyncQueries";
import {
  BottomSheet,
  Button,
  EmptyState,
  ErrorState,
  HeroHeader,
  IconButton,
  LoadingState,
  Row,
  SectionHeader,
  StatGrid,
  StatusPill,
  TextField,
  Toast,
  type Stat,
  type ToastMessage,
} from "../ui";
import { formatTripDate } from "../logs/logbook";
import { TripEditSheet } from "../logs/TripEditSheet";
import { PlaceEditSheet } from "./PlaceEditSheet";
import { placeDeleteConfirm } from "./placeDeleteConfirm";
import { PLACE_STATUS_META, placeStatus } from "./placeMeta";

/** A parked value as one line. Objects are stringified rather than dropped:
 *  the point of the section is that the user can SEE what arrived before
 *  deciding what to do with it. */
function foreignValueText(value: unknown): string {
  if (value === null || value === undefined) return "No value";
  if (typeof value === "object") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

/** Extent of a drawn route's points, for "show it on the map". Built at
 *  render time and never stored — a region of interest stays off the server. */
function routeBbox(points: [number, number][]): [number, number, number, number] {
  const lons = points.map(([lon]) => lon);
  const lats = points.map(([, lat]) => lat);
  return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
}

export function PlaceDetailScreen({
  placeId,
  onBack,
  onOpenTrip,
  onShowOnMap,
  onFocusOnMap,
  onDrawRoute,
  onShowPlaceOnMap,
  onDeleted,
}: {
  placeId: string;
  onBack: () => void;
  /** Opens one of the viewer's own logged trips at this place. */
  onOpenTrip: (trip: MirrorTrip) => void;
  onShowOnMap: (place: MirrorPlace) => void;
  /** Opens the Map tab framed on a route's extent — a media route attachment
   *  (its bbox resolved here, first) or a drawn route's own points. Neither
   *  is drawn on the map; this only flies the camera there. */
  onFocusOnMap: (bbox: [number, number, number, number]) => void;
  /** Opens the Map tab with the draw tool armed, saving into this place's slot. */
  onDrawRoute?: (placeId: string) => void;
  /** Centres the map on one of the places linked to this one. */
  onShowPlaceOnMap?: (place: { latitude: number; longitude: number }) => void;
  /** The place this screen is showing is gone — leave, don't render a husk. */
  onDeleted: () => void;
}) {
  const query = useMirrorPlace(placeId);
  const media = useMirrorMedia("place", placeId);
  const trips = useMirrorTrips();
  const routes = useMirrorRoutes();
  const placeLinks = useMirrorPlaceLinks();
  const placeTypes = useMirrorPlaceTypes();
  const placesQuery = useMirrorPlaces();
  const online = useConnectivity() === "online";
  // The same capability gating every Share row spreads — removing a share is
  // the same online-and-signed-in action, seen from the other end.
  const shareRowProps = useShareRowProps(online);
  // Definitions give each stored value its real label; a guest's come off the
  // device, an account's off the user record. Without them (offline with an
  // account, or a field deleted since) the key renders un-slugged.
  const { defs: fieldDefs } = useFieldDefs("place");

  const [editing, setEditing] = useState(false);
  const [logging, setLogging] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [shareOpenRequest, setShareOpenRequest] = useState(0);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const toastNonce = useRef(0);
  const notify = useCallback((text: string, tone: "info" | "error") => {
    toastNonce.current += 1;
    setToast({ text, tone, nonce: toastNonce.current });
  }, []);

  // Above the early returns — hooks cannot be conditional.
  const [addingWay, setAddingWay] = useState(false);
  const [routeSlotMenu, setRouteSlotMenu] = useState(false);
  /** The link picker, and the text narrowing it. */
  const [linking, setLinking] = useState(false);
  const [linkQuery, setLinkQuery] = useState("");
  /** A linked place whose row was tapped — the sheet that offers to unlink it. */
  const [linkMenuId, setLinkMenuId] = useState<string | null>(null);
  /** The parked value whose three actions are open, and whether one is running.
   *  The KEY rather than the item: the item is re-read from the place, so the
   *  sheet cannot go on showing a value the server has already moved. */
  const [foreignKey, setForeignKey] = useState<string | null>(null);
  const [resolvingForeign, setResolvingForeign] = useState(false);

  const place = query.data;

  if (query.loading && !place) return <LoadingState />;
  if (query.error && !place) {
    return <ErrorState message={query.error} onRetry={query.refresh} />;
  }
  if (!place) {
    return <EmptyState title="Place not found" hint="It may have been deleted." />;
  }

  const isOwner = place.syncRole === "owner";
  const attachments = media.data ?? [];
  const linkedTrips = (trips.data ?? []).filter((trip) =>
    trip.places.some((link) => link.id === placeId),
  );
  const status = placeStatus(place, linkedTrips.length);
  const statusMeta = PLACE_STATUS_META[status];
  const grade = formatCanyonGrade(place);

  const photoCount = attachments.filter((item) => {
    const category = mediaCategory(item.mediaType);
    return category === "image" || category === "video";
  }).length;
  // The place's route slot, as filled by a DRAWN route. It is a Route row,
  // not media, so nothing in MediaStrip would ever show it — and a link that
  // appears to do nothing is worse than no link at all.
  const linkedRoute =
    (routes.data ?? []).find((route) => route.placeId === placeId) ?? null;
  // Symmetric and many-to-many, unlike the route slot: a carpark serving three
  // canyons off one trailhead is linked from all three, and the link is stored
  // once with this place at either end.
  const linkedPlaceIds = new Set(
    (placeLinks.data ?? [])
      .filter((link) => link.aPlaceId === placeId || link.bPlaceId === placeId)
      .map((link) => (link.aPlaceId === placeId ? link.bPlaceId : link.aPlaceId)),
  );
  const linkedPlaces = (placesQuery.data ?? [])
    .filter((row) => linkedPlaceIds.has(row.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  const routeCount = attachments.filter(
    (item) => mediaCategory(item.mediaType) === "track",
  ).length;
  /** Values that arrived on a COPY, keyed by definitions this account does not
   *  have (§2.6). Owner-private — the server never sends them on a shared row,
   *  so a sharee's place has none and this section does not render. */
  const foreignFields = place.foreignFields ?? [];
  const foreignItem = foreignFields.find((item) => item.key === foreignKey) ?? null;
  // Which of the two writers put them there. `forkedFromId` is set only by a
  // copy, so its absence means the other one — a type change.
  const isCopied = place.forkedFromId != null;
  // A BUILT-IN KEY CANNOT BE ADOPTED, and the server says so with a 409: the
  // system definitions own those keys, and a user definition over one would
  // give the place two writers for it. Offering the action anyway meant the
  // only way to find out was to tap it and be told no. Nothing is lost by the
  // refusal — a built-in comes home by itself when the place is put back on a
  // type that defines it (`strandValuesOnTypeChange`).
  const foreignIsBuiltIn = foreignItem != null && isReservedFieldKey(foreignItem.key);

  // The user-visible values, internal `_`-prefixed entries excluded. The
  // definitions that label them are the viewer's own — or, for a place shared
  // from a type they do not own, the snapshot the delta row carried, without
  // which they would see bare keys.
  const placeTypeName =
    (placeTypes.data ?? []).find((type) => type.id === place.placeTypeId)?.name ??
    "Place";
  const storedFields = userFieldValues(place.fieldValues);
  const labellingDefs = [...fieldDefs, ...(place.fieldDefsSnapshot ?? [])];
  const customFields = [
    ...labellingDefs
      .filter((def) => storedFields[def.key] !== undefined)
      .map(
        (def) =>
          [
            // The bare LABEL, not `customFieldDisplayLabel`: the "(1-5)" that
            // helps someone typing into a box is noise beside a value that has
            // already been typed.
            def.label,
            storedFields[def.key],
          ] as const,
      ),
    ...Object.entries(storedFields)
      .filter(([key]) => !labellingDefs.some((def) => def.key === key))
      .map(([key, value]) => [humanizeFieldKey(key), value] as const),
  ];

  // OVERVIEW IS WHAT EVERY PLACE HAS, and that is only its position.
  //
  // It used to promote four canyon scalars — Rating, Abseils, Longest drop,
  // Hours — into stat tiles by reading their reserved keys directly. Three
  // things were wrong with that. They are not universal (a campsite has no
  // longest drop, so the section's content depended on which type you were
  // looking at while its heading did not); they were ALREADY listed below in
  // the type's own attribute table, so a canyon printed each of them twice; and
  // "Rating" was a bespoke relabelling of a definition whose label is
  // "Quality", so the same field had two names on one screen. Everything a type
  // records now renders in one place, under the type's own heading, by the one
  // rule.
  const stats: Stat[] = [];
  const position = `${place.latitude.toFixed(5)}, ${place.longitude.toFixed(5)}`;
  const copyPosition = () => {
    // RN core Clipboard: deprecated upstream but still shipped, and it needs no
    // native module — the same copy the waypoint and tapped-point sheets use.
    Clipboard.setString(position);
    notify("Coordinates copied.", "info");
  };
  stats.push({ label: "Position", value: position, wide: true, onPress: copyPosition });

  /**
   * One of the three actions on a parked value. The place is re-read from the
   * mirror after it lands, because all three change the row — adopt also
   * creates a definition, which the form above reads.
   */
  const runForeignAction = (action: ForeignFieldAction) => {
    const item = foreignItem;
    if (!item) return;
    setResolvingForeign(true);
    resolveForeignField(placeId, item.key, action)
      .then(() => {
        setForeignKey(null);
        query.refresh();
        notify(
          action === "adopt"
            ? `“${item.label}” is one of your fields now.`
            : action === "notes"
              ? "Added to the notes."
              : "Discarded.",
          "info",
        );
      })
      .catch((err: unknown) => {
        console.error(err);
        notify(messageFromError(err, "Couldn't do that just now."), "error");
      })
      .finally(() => setResolvingForeign(false));
  };

  const openInMapsApp = () => {
    const label = encodeURIComponent(place.name);
    const url =
      Platform.OS === "ios"
        ? `maps:0,0?q=${label}@${place.latitude},${place.longitude}`
        : `geo:${place.latitude},${place.longitude}?q=${place.latitude},${place.longitude}(${label})`;
    Linking.openURL(url).catch(() => {
      Alert.alert("Couldn't open maps", "No maps app is available on this device.");
    });
  };

  const confirmRemoveShare = () => {
    const confirm = removeShareConfirm({
      kindLabel: "place",
      itemName: place.name,
    });
    Alert.alert(confirm.title, confirm.body, [
      { text: "Cancel", style: "cancel" },
      {
        // Not `destructive`: the owner keeps the place, its notes and its
        // photos. Only this account's view of them goes.
        text: "Remove",
        onPress: () => {
          setRemoving(true);
          removeSharedPlace(place.id)
            // Same exit as a delete: the screen is showing a place this
            // account can no longer see.
            .then(onDeleted)
            .catch((err: unknown) => {
              console.error(err);
              notify(
                messageFromError(err, "Couldn't remove this shared place."),
                "error",
              );
              setRemoving(false);
            });
        },
      },
    ]);
  };

  const confirmDelete = () => {
    const confirm = placeDeleteConfirm(place.name, linkedTrips.length);
    Alert.alert(
      confirm.confirmTitle,
      confirm.confirmBody,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            deletePlaceLocal(place.id)
              .then(onDeleted)
              .catch((err: unknown) => {
                console.error(err);
                notify("Couldn't delete this place.", "error");
              });
          },
        },
      ],
    );
  };

  return (
    <View style={styles.screen}>
      <HeroHeader
        eyebrow="Place"
        title={place.name}
        titleNumberOfLines={2}
        onBack={onBack}
        action={
          isOwner ? (
            <IconButton
              icon="edit-2"
              accessibilityLabel="Edit place"
              color={theme.accent}
              filled
              onPress={() => setEditing(true)}
            />
          ) : undefined
        }
      >
        <View style={styles.pillRow}>
          {/* The grade rides as a pill rather than as the eyebrow: the eyebrow
              style is uppercase, and a place grade is written with a lowercase
              v/a ("v4a4 III") — upcasing it renders a grade nobody writes. */}
          {grade ? <StatusPill label={grade} tone="outline" /> : null}
          <StatusPill
            label={status === "done" ? tickLabel(linkedTrips.length) : statusMeta.label}
            icon={statusMeta.icon}
            hue={statusMeta.hue}
          />
          {place.altNames.length > 0 ? (
            <StatusPill label={`A.K.A. ${place.altNames.join(", ")}`} tone="outline" />
          ) : null}
        </View>
      </HeroHeader>

      <ScrollView contentContainerStyle={styles.body}>
        {/* The two things you do standing at a trailhead. Both work offline. */}
        <View style={styles.actionRow}>
          <View style={styles.action}>
            <Button
              label="Show on map"
              icon="map"
              variant="outlineAccent"
              onPress={() => onShowOnMap(place)}
            />
          </View>
          <View style={styles.action}>
            <Button label="Log a trip" icon="edit-3" onPress={() => setLogging(true)} />
          </View>
        </View>

        <SectionHeader label="Overview" />
        <StatGrid stats={stats} />
        <Row
          icon="navigation"
          title="Open in a maps app"
          subtitle="Opens your navigation app to this location."
          onPress={openInMapsApp}
        />

        {customFields.length > 0 ? (
          <>
            {/* Named for the TYPE, like the form and the filter sheet: on a
                campsite these are Capacity and Is-a-cave, which are the app's,
                not the user's. */}
            <SectionHeader label={`${placeTypeName} ${ATTRIBUTE_NOUN.many}`} />
            <View style={styles.fieldCard}>
              {customFields.map(([label, value], index) => (
                <View
                  key={label}
                  style={[
                    styles.fieldRow,
                    index === customFields.length - 1 ? styles.fieldRowLast : null,
                  ]}
                >
                  <Text style={styles.fieldKey}>{label}</Text>
                  <Text style={styles.fieldValue}>{formatFieldValue(value)}</Text>
                </View>
              ))}
            </View>
          </>
        ) : null}

        {isOwner && foreignFields.length > 0 ? (
          <>
            <SectionHeader
              label={`Doesn\u2019t fit this type · ${foreignFields.length}`}
            />
            {/* Named for the CONDITION, not the cause, because there are two of
                them: a type change strands what the new type has no definition
                for, and a copy carries values keyed by the sender's. "Came with
                this place" was only ever true of the second. The sentence below
                names whichever one applies. */}
            <Text style={styles.muted}>
              {isCopied
                ? `These came across when you copied this place. Tap one to decide what to do with it.`
                : `These are left over from when you changed this place\u2019s type. Tap one to decide what to do with it.`}
            </Text>
            {/* A CARD PER ROW, not the hairline table above it. The two
                sections look different because they ARE different: the one
                above is a list of facts, and every row here is a decision the
                user has to make. The table style that stopped the facts
                inviting a tap took the invitation off these too, where it is
                the whole point — so these use the same `Row` as every other
                tappable thing in the app, chevron and all. */}
            {foreignFields.map((item) => (
              <Row
                key={item.key}
                icon="help-circle"
                title={item.label}
                subtitle={foreignValueText(item.value)}
                right={<Feather name="chevron-right" size={20} color={theme.textMuted} />}
                onPress={() => setForeignKey(item.key)}
              />
            ))}
          </>
        ) : null}

        <SectionHeader label={place.notes ? "Notes · visible to anyone you share with" : "Notes"} />
        {place.notes ? (
          <Text style={styles.notes}>{place.notes}</Text>
        ) : (
          <Text style={styles.muted}>Nothing written down.</Text>
        )}

        <SectionHeader
          label={photoCount === 0 ? "Photos & videos" : `Photos & videos · ${photoCount}`}
        />
        <MediaStrip
          kind="media"
          online={online}
          linkedType="place"
          linkedId={placeId}
          media={attachments}
          emptyHint="No photos yet."
          onFailed={(text) => notify(text, "error")}
        />

        <SectionHeader label={routeCount === 0 ? "Routes" : `Routes · ${routeCount}`} />
        {/* One route per place — the API enforces it, so the UI has to as well
            (see `limit` in MediaStrip).

            NOT BUILT YET: the web has a map layer toggle that draws every
            place's route at once (`showPlaceTracks` in LayersPanel +
            `GET /places/tracks`). The mobile map has no equivalent; a tap here
            draws this ONE route transiently. Belongs in the map-page redesign,
            where the layer sheet lives — the mirror already holds the files, so
            it can work offline. */}
        {/* The slot is filled by a DRAWN route: show it, and skip the media
            strip entirely rather than rendering an "add a file" affordance for
            a slot that is taken. Swapping back to a file means unlinking the
            route first, from its own options. */}
        {linkedRoute ? (
          <>
            <Row
              title={linkedRoute.name}
              subtitle={`Drawn route · ${formatDistanceM(routeLengthM(linkedRoute.points))}`}
              icon="edit-3"
              hue={assetHue.route}
              onPress={() => onFocusOnMap(routeBbox(linkedRoute.points))}
              right={
                isOwner ? (
                  <IconButton
                    icon="more-horizontal"
                    accessibilityLabel="Route options"
                    onPress={() => setRouteSlotMenu(true)}
                  />
                ) : undefined
              }
            />
            <Text style={styles.muted}>
              One route per place.
            </Text>
          </>
        ) : (
          <MediaStrip
            kind="track"
            online={online}
            limit={1}
            linkedType="place"
            linkedId={placeId}
            media={attachments}
            // Not "Attach a .gpx or .kml" any more: the slot takes a drawn
            // route, an import or a recording as readily as a file, and naming
            // only the file promised the least of the five (see AddWaySheet).
            emptyHint="Add a route, a file or a recording."
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
            // The slot's five sources are one panel, owned by this screen —
            // three of them are not media at all, so the strip does not try to
            // offer them (AddWaySheet.tsx).
            onAddWay={isOwner ? () => setAddingWay(true) : undefined}
          />
        )}

        {/* Places linked to this one — the carpark, the campsite, the exit.
            Editable from the phone: linking is an outbox op like everything
            else, so it works standing at the carpark with no signal, which is
            where you find out the two belong together.


            NAVIGATIONAL ONLY: a link grants no visibility, so this section is
            the owner's own filing and a recipient sees nothing here (the
            server sends them no links at all). Coordinates stay off the rows —
            this is a list. */}
        {isOwner ? (
          <>
            <SectionHeader
              label={
                linkedPlaces.length === 0
                  ? "Linked places"
                  : `Linked places · ${linkedPlaces.length}`
              }
            />
            {linkedPlaces.length === 0 ? null : (
              linkedPlaces.map((linked) => (
                <Row
                  key={linked.id}
                  icon="map-pin"
                  title={linked.name}
                  onPress={() => onShowPlaceOnMap?.(linked)}
                  // The row's own action is "show me where that is"; the verb
                  // that CHANGES something sits behind its own control, so a
                  // thumb reaching for the map cannot unlink instead.
                  right={
                    <IconButton
                      icon="more-vertical"
                      accessibilityLabel={`Options for ${linked.name}`}
                      onPress={() => setLinkMenuId(linked.id)}
                    />
                  }
                />
              ))
            )}
            <Row
              icon="link"
              title="Link a place"
              subtitle="A carpark, a campsite, the exit."
              onPress={() => {
                setLinkQuery("");
                setLinking(true);
              }}
            />
          </>
        ) : null}

        {/* VALUES THAT ARRIVED ON A COPY, in their own read-only section (§2.6).
            They are not in this account's form and not on its other places:
            copying one campsite must not change the form on all forty. The
            three actions below ARE the schema decision, made by the user with
            the value in front of them.

            Owner-private: a place shared WITH someone carries none of this, so
            the labels and values of whoever they came from stop here. */}
        {/* Your own history here — the half a "done" badge can't tell you. Only
            ever your own trips: another person's visits to a place they shared
            with you are theirs, and never reach this device. */}
        <SectionHeader
          label={linkedTrips.length === 0 ? "Your trips" : `Your trips · ${linkedTrips.length}`}
        />
        {linkedTrips.length === 0 ? (
          <Text style={styles.muted}>
            {isOwner
              ? "No trips logged here yet."
              : "Log a trip to this place and it will appear here."}
          </Text>
        ) : (
          linkedTrips
            .slice()
            .sort((a, b) => b.date.localeCompare(a.date))
            .map((trip) => (
              <Row
                key={trip.id}
                icon="book-open"
                hue={theme.accent}
                title={tripTitle(trip)}
                subtitle={formatTripDate(trip.date)}
                right={<Feather name="chevron-right" size={20} color={theme.textMuted} />}
                onPress={() => onOpenTrip(trip)}
              />
            ))
        )}

        {isOwner ? (
          <>
            <PlaceSharingSection
              placeId={placeId}
              placeName={place.name}
              online={online}
              openRequest={shareOpenRequest}
              onShareRequested={() => setShareOpenRequest((n) => n + 1)}
            />
            <SectionHeader label="Danger zone" />
            <Row
              icon="trash-2"
              hue={theme.warning}
              title="Delete place"
              onPress={confirmDelete}
            />
          </>
        ) : (
          <>
            {/* The recipient's half. A place share is always DIRECT — there is
                nothing above a place for it to be inherited from — so this row
                is offered on every shared place. Online-only, like every other
                share action, and dimmed with the reason rather than hidden. */}
            <SectionHeader label="Shared with you" />
            <Row
              icon="x-circle"
              hue={theme.warning}
              title="Remove from my account"
              {...shareRowProps}
              disabled={removing || shareRowProps.disabled}
              onPress={confirmRemoveShare}
            />
          </>
        )}
      </ScrollView>

      <PlaceEditSheet
        visible={editing}
        place={place}
        onClose={() => setEditing(false)}
        onSaved={(text) => notify(text, "info")}
        onFailed={(text) => notify(text, "error")}
      />

      <TripEditSheet
        online={online}
        visible={logging}
        places={placesQuery.data ?? []}
        initialPlaces={[{ id: place.id, name: place.name }]}
        existingTypes={distinctTripTypes(trips.data ?? [])}
        onClose={() => setLogging(false)}
        onSaved={(text) => notify(text, "info")}
        onFailed={(text) => notify(text, "error")}
      />

      {/* Changing what fills the route slot, from the place it belongs to —
          the same two verbs the route's own options offer, where the user is
          looking at the slot rather than at the route. */}
      {/* The link picker: this account's own places, narrowed by typing. A
          shared place is not offered — the server refuses a link to one, so
          offering it would be a 400 waiting to happen (`linkablePlaces`). */}
      <BottomSheet
        visible={linking}
        onClose={() => setLinking(false)}
        title="Link a place"
      >
        <View style={styles.sheetBody}>
          <TextField
            label="Find a place"
            value={linkQuery}
            onChangeText={setLinkQuery}
            autoCapitalize="none"
          />
          {(() => {
            const candidates = (placesQuery.data ?? []).filter(
              (row) => row.id !== placeId && !linkedPlaceIds.has(row.id),
            );
            const { visible, hiddenCount } = linkablePlaces(candidates, linkQuery);
            const hint = truncationHint(visible.length, hiddenCount);
            if (visible.length === 0) {
              return (
                <Text style={styles.muted}>
                  {(placesQuery.data ?? []).length <= 1
                    ? "This is the only place you have."
                    : candidates.length === 0
                      ? "Every other place is already linked to this one."
                      : "No place matches that."}
                </Text>
              );
            }
            return (
              <>
                {visible.map((row) => (
                  <Row
                    key={row.id}
                    icon="map-pin"
                    title={row.name}
                    onPress={() => {
                      setLinking(false);
                      createPlaceLinkLocal(placeId, row.id)
                        .then(() => notify(`Linked to ${row.name}.`, "info"))
                        .catch((err: unknown) => {
                          console.error(err);
                          notify("Couldn't link that place.", "error");
                        });
                    }}
                  />
                ))}
                {hint ? <Text style={styles.muted}>{hint}</Text> : null}
              </>
            );
          })()}
        </View>
      </BottomSheet>

      {/* Unlinking, from the linked row's own sheet. A link grants no
          visibility either way, so removing one takes nothing from anybody —
          which is why it asks nothing and is not styled as destructive. */}
      <BottomSheet
        visible={linkMenuId !== null}
        onClose={() => setLinkMenuId(null)}
        title={
          linkedPlaces.find((row) => row.id === linkMenuId)?.name ?? "Linked place"
        }
      >
        <View style={styles.sheetBody}>
          <Row
            icon="link-2"
            hue={theme.warning}
            title="Unlink from this place"
            subtitle="Both places are kept."
            onPress={() => {
              const target = (placeLinks.data ?? []).find(
                (link) =>
                  (link.aPlaceId === placeId && link.bPlaceId === linkMenuId) ||
                  (link.bPlaceId === placeId && link.aPlaceId === linkMenuId),
              );
              setLinkMenuId(null);
              if (!target) return;
              deletePlaceLinkLocal(target.id)
                .then(() => notify("Unlinked.", "info"))
                .catch((err: unknown) => {
                  console.error(err);
                  notify("Couldn't unlink that place.", "error");
                });
            }}
          />
        </View>
      </BottomSheet>

      {/* The three actions on one parked value. ONLINE-ONLY: `foreignFields` is
          not client-writable by design, so there is no op to queue — the rows
          say "Needs a connection" rather than failing at the tap, the same rule
          sharing follows. */}
      <BottomSheet
        visible={foreignItem !== null}
        onClose={() => (resolvingForeign ? undefined : setForeignKey(null))}
        // The value's own LABEL used to be the title, with the bare value as
        // the only body — a panel headed "A grade" over a lone "4" reads as a
        // formatting accident rather than a question. The title says what the
        // panel is for, and the label/value pair is shown as the same two-column
        // row it has in the table it was tapped in, so the thing being decided
        // about is recognisably the thing that was tapped.
        title="What should this become?"
      >
        <View style={styles.sheetBody}>
          <View style={[styles.fieldRow, styles.fieldRowLast]}>
            <Text style={styles.fieldKey}>{foreignItem?.label}</Text>
            <Text style={styles.fieldValue}>{foreignValueText(foreignItem?.value)}</Text>
          </View>
          {/* HIDDEN on a built-in key, not greyed out, and with no sentence
              standing in for it either. A reserved key cannot be adopted at all
              — the system definition already owns it, and the API answers 409 —
              so this is not an action that is unavailable right now, it is one
              that does not exist for this value. An absent row asks nothing and
              needs no explaining; a disabled row, or a paragraph about a verb
              that is not on screen, is the panel apologising for itself. */}
          {foreignIsBuiltIn ? null : (
            <Row
              icon="plus-circle"
              title={`Create a new ${ATTRIBUTE_NOUN.one} for this place type`}
              // No explanation line: the three titles say what they do, and a
              // sentence under each turned a three-item menu into a wall. The
              // slot is kept for the one thing the user cannot see — no
              // connection.
              subtitle={online ? undefined : "Needs a connection"}
              disabled={!online || resolvingForeign}
              onPress={() => runForeignAction("adopt")}
            />
          )}
          <Row
            icon="file-text"
            title="Add to notes as text"
            subtitle={online ? undefined : "Needs a connection"}
            disabled={!online || resolvingForeign}
            onPress={() => runForeignAction("notes")}
          />
          <Row
            icon="trash-2"
            hue={theme.warning}
            title="Discard"
            subtitle={online ? undefined : "Needs a connection"}
            disabled={!online || resolvingForeign}
            // The only one of the three that LOSES something, one tap inside a
            // sheet one tap from a row. Everything else destructive in this app
            // asks first.
            onPress={() => {
              const item = foreignItem;
              if (!item) return;
              Alert.alert(
                `Discard "${item.label}"?`,
                "The value is removed from this place. This can't be undone.",
                [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Discard",
                    style: "destructive",
                    onPress: () => runForeignAction("discard"),
                  },
                ],
              );
            }}
          />
        </View>
      </BottomSheet>

      <BottomSheet
        visible={routeSlotMenu}
        onClose={() => setRouteSlotMenu(false)}
        title={linkedRoute?.name ?? "Route"}
      >
        <View style={styles.sheetBody}>
          {/* The SAME panel the empty slot opens: replacing was narrower than
              adding until this batch, and a slot that only accepts a drawn
              route on the way in is a slot with two different rules. */}
          <Row
            title="Replace with another way"
            icon="repeat"
            hue={assetHue.route}
            onPress={() => {
              setRouteSlotMenu(false);
              setAddingWay(true);
            }}
          />
          <Row
            title="Unlink from this place"
            subtitle="The route is kept."
            icon="link-2"
            hue={theme.warning}
            onPress={() => {
              const target = linkedRoute;
              setRouteSlotMenu(false);
              if (!target) return;
              updateRouteLocal(target.id, { placeId: null })
                .then(() => notify("Route unlinked.", "info"))
                .catch((err: unknown) => {
                  console.error(err);
                  notify(messageFromError(err, "Couldn't unlink that route."), "error");
                });
            }}
          />
        </View>
      </BottomSheet>

      {/* Every way of filling this place's one route slot, from the empty
          slot AND from the replace row above — one panel, one displacement
          decision (places/routeSlot.ts). */}
      <AddWaySheet
        placeId={placeId}
        placeName={place.name}
        media={attachments}
        visible={addingWay}
        onClose={() => setAddingWay(false)}
        onDrawRoute={onDrawRoute ? () => onDrawRoute(placeId) : undefined}
        onInfo={(text) => notify(text, "info")}
        onError={(text) => notify(text, "error")}
      />

      <Toast message={toast} onDismissed={() => setToast(null)} />
    </View>
  );
}

/**
 * Per-place sharing — owner-only, and online-only: the grant/revoke actions hit
 * REST directly because managing shares is not a field use case. The resulting
 * record and its tombstone still propagate to the sharee's mirror on their next
 * pull. Recipients and the friend picker are username-only (never email).
 *
 * The state, the panel and the friend picker come from `useSharePanel`, shared
 * with every other sharing surface; only this at-a-glance section is local.
 *
 * `openRequest` lets a caller trigger the picker without lifting this
 * component's state out of it.
 */
function PlaceSharingSection({
  placeId,
  placeName,
  online,
  openRequest,
  onShareRequested,
}: {
  placeId: string;
  placeName: string;
  online: boolean;
  openRequest: number;
  onShareRequested: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);

  // THE sharing panel, identical to the one Saved, the route sheet, the track
  // sheet and the map's waypoint sheet render. Only the endpoints (places keep
  // their own — the hybrid share model lives behind them) and the sentence are
  // place-specific, and both are arguments to the same hook.
  const { title, body, sharing } = useSharePanel({
    target: { kind: "place", placeId },
    itemLabel: placeName,
    online,
    // The recipients load with the SECTION, not with the picker: this screen
    // lists them whether or not the sheet is ever opened. Friends load only
    // once the sheet is up.
    active: pickerOpen,
  });

  const openPicker = useCallback(() => {
    setPickerOpen(true);
  }, []);

  // openRequest starts at 0; only act once the caller has bumped it.
  useEffect(() => {
    if (openRequest > 0) openPicker();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest]);

  return (
    <>
      <SectionHeader
        label={
          sharing.recipients && sharing.recipients.length > 0
            ? `Shared with · ${sharing.recipients.length}`
            : "Shared with"
        }
      />
      <SharingError sharing={sharing} />
      <RecipientRows sharing={sharing} />

      {/* Offline this door is closed WITH THE REASON in place of its subtitle
          (DESIGN.md §10) rather than hidden, so the feature doesn't appear to
          come and go. */}
      <Row
        icon="share-2"
        title="Share with a friend"
        subtitle={shareRowSubtitle(sharing)}
        disabled={!sharing.canShare || sharing.loadFailed}
        onPress={onShareRequested}
      />

      <BottomSheet
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title={title}
      >
        {body}
      </BottomSheet>
    </>
  );
}

function tickLabel(trips: number): string {
  // "Visited", like the Places rail and the filter sheet. This chip was the one
  // place "Done" survived the rename, directly under a list that said Visited.
  return trips === 1 ? "Visited · 1 trip" : `Visited · ${trips} trips`;
}

/** Fallback label for a value whose DEFINITION is gone — deleted on another
 * device, or not loaded because we are offline. Keys are slugs of the original
 * label, so un-slugging beats showing `water_level` raw. */
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
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing(0.75) },
  body: { paddingHorizontal: spacing(2), paddingBottom: spacing(4), gap: spacing(1) },
  actionRow: { flexDirection: "row", gap: spacing(1), paddingTop: spacing(0.5) },
  action: { flex: 1 },
  muted: { color: theme.textMuted, fontSize: fontSize.sm },
  notes: { color: theme.textPrimary, fontSize: fontSize.base, lineHeight: lineHeight.body },
  spinner: { alignSelf: "flex-start" },
  sheetBody: { gap: spacing(1) },
  // A TABLE, NOT A CARD. The filled card read as a control — it had the
  // surface, border and radius every tappable thing on this screen has — so a
  // list of facts invited a tap that does nothing. And with the rows only
  // spaced apart, a long label and a right-aligned value had nothing but white
  // space between them, which is hard to track across on a phone. Hairline
  // rules per row give the eye the line to follow and cost no colour.
  fieldCard: { gap: 0 },
  fieldRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: spacing(2),
    paddingVertical: spacing(0.875),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: surface.border,
  },
  fieldRowLast: { borderBottomWidth: 0 },
  fieldKey: { color: theme.textMuted, fontSize: fontSize.sm, flexShrink: 1 },
  fieldValue: {
    color: theme.textPrimary,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    textAlign: "right",
    flexShrink: 1,
  },
});
