// Canyon detail — "what am I walking into?" (DESIGN.md §1). The grade, the
// numbers that decide the day, and the notes come first; sharing and admin sit
// below them, because you read this screen at a trailhead and manage it at home.
//
// Reads live from the offline mirror, so an optimistic edit shows immediately.
// An inaccessible canyon never reaches the mirror, so it renders the same "not
// found" state as a nonexistent one — the API's 404-not-403 anti-oracle,
// preserved locally.
//
// PRIVACY: this is the one screen that does show a coordinate, because it is the
// answer to its own question and the user asked for this canyon by name. It
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
  customFieldDisplayLabel,
  distinctTripTypes,
  formatCanyonGrade,
  formatDistanceM,
  mediaCategory,
  messageFromError,
  routeLengthM,
} from "@logjam/shared";

import { tripTitle } from "../api/tripTitle";
import {
  RecipientRows,
  shareRowSubtitle,
  SharingError,
} from "../sharing/useSharing";
import { useSharePanel } from "../sharing/SharePanel";
import { useFieldDefs } from "../customFields/useFieldDefs";
import { useConnectivity } from "../map/connectivity";
import { MediaStrip } from "../media/MediaStrip";
import { resolveRouteAttachmentBbox } from "../media/routeAttachmentBbox";
import { AddWaySheet } from "./AddWaySheet";
import {
  assetHue,
  fontSize,
  fontWeight,
  lineHeight,
  radius,
  spacing,
  surface,
  theme,
} from "../theme";
import type { MirrorCanyon, MirrorTrip } from "../sync/mirrorStore";
import { deleteCanyonLocal, updateRouteLocal } from "../sync/outbox";
import {
  useMirrorCanyon,
  useMirrorCanyons,
  useMirrorMedia,
  useMirrorRoutes,
  useMirrorWaypoints,
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
  Toast,
  type Stat,
  type ToastMessage,
} from "../ui";
import { formatTripDate } from "../logs/logbook";
import { TripEditSheet } from "../logs/TripEditSheet";
import { CanyonEditSheet } from "./CanyonEditSheet";
import { canyonDeleteConfirm } from "./canyonDeleteConfirm";
import { waypointSymbol } from "../map/waypointSymbol";
import { CANYON_STATUS_META, canyonStatus } from "./canyonMeta";

/** Extent of a drawn route's points, for "show it on the map". Built at
 *  render time and never stored — a region of interest stays off the server. */
function routeBbox(points: [number, number][]): [number, number, number, number] {
  const lons = points.map(([lon]) => lon);
  const lats = points.map(([, lat]) => lat);
  return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
}

export function CanyonDetailScreen({
  canyonId,
  onBack,
  onOpenTrip,
  onShowOnMap,
  onFocusOnMap,
  onDrawRoute,
  onShowWaypointOnMap,
  onDeleted,
}: {
  canyonId: string;
  onBack: () => void;
  /** Opens one of the viewer's own logged trips at this canyon. */
  onOpenTrip: (trip: MirrorTrip) => void;
  onShowOnMap: (canyon: MirrorCanyon) => void;
  /** Opens the Map tab framed on a route's extent — a media route attachment
   *  (its bbox resolved here, first) or a drawn route's own points. Neither
   *  is drawn on the map; this only flies the camera there. */
  onFocusOnMap: (bbox: [number, number, number, number]) => void;
  /** Opens the Map tab with the draw tool armed, saving into this canyon's slot. */
  onDrawRoute?: (canyonId: string) => void;
  /** Centres the map on one of this canyon's linked waypoints. */
  onShowWaypointOnMap?: (waypoint: { latitude: number; longitude: number }) => void;
  /** The canyon this screen is showing is gone — leave, don't render a husk. */
  onDeleted: () => void;
}) {
  const query = useMirrorCanyon(canyonId);
  const media = useMirrorMedia("canyon", canyonId);
  const trips = useMirrorTrips();
  const routes = useMirrorRoutes();
  const waypoints = useMirrorWaypoints();
  const canyonsQuery = useMirrorCanyons();
  const online = useConnectivity() === "online";
  // Definitions give each stored value its real label; a guest's come off the
  // device, an account's off the user record. Without them (offline with an
  // account, or a field deleted since) the key renders un-slugged.
  const { defs: fieldDefs } = useFieldDefs("canyon");

  const [editing, setEditing] = useState(false);
  const [logging, setLogging] = useState(false);
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

  const canyon = query.data;

  if (query.loading && !canyon) return <LoadingState />;
  if (query.error && !canyon) {
    return <ErrorState message={query.error} onRetry={query.refresh} />;
  }
  if (!canyon) {
    return <EmptyState title="Canyon not found" hint="It may have been deleted." />;
  }

  const isOwner = canyon.syncRole === "owner";
  const attachments = media.data ?? [];
  const linkedTrips = (trips.data ?? []).filter((trip) =>
    trip.canyons.some((link) => link.id === canyonId),
  );
  const status = canyonStatus(canyon, linkedTrips.length);
  const statusMeta = CANYON_STATUS_META[status];
  const grade = formatCanyonGrade(canyon);

  const photoCount = attachments.filter((item) => {
    const category = mediaCategory(item.mediaType);
    return category === "image" || category === "video";
  }).length;
  // The canyon's route slot, as filled by a DRAWN route. It is a Route row,
  // not media, so nothing in MediaStrip would ever show it — and a link that
  // appears to do nothing is worse than no link at all.
  const linkedRoute =
    (routes.data ?? []).find((route) => route.canyonId === canyonId) ?? null;
  // Many-to-many, unlike the route slot: a carpark serving three canyons off
  // one trailhead appears on all three.
  const linkedWaypoints = (waypoints.data ?? [])
    .filter((waypoint) => waypoint.canyonIds.includes(canyonId))
    .sort((a, b) => a.name.localeCompare(b.name));
  const routeCount = attachments.filter(
    (item) => mediaCategory(item.mediaType) === "track",
  ).length;

  const storedFields = canyon.attributes?.customFields ?? {};
  const customFields = [
    ...fieldDefs
      .filter((def) => storedFields[def.key] !== undefined)
      .map((def) => [customFieldDisplayLabel(def), storedFields[def.key]] as const),
    ...Object.entries(storedFields)
      .filter(([key]) => !fieldDefs.some((def) => def.key === key))
      .map(([key, value]) => [humanizeFieldKey(key), value] as const),
  ];

  // Grade is in the hero pill row, a few pixels above — no need to state it
  // twice in a row.
  const stats: Stat[] = [];
  if (canyon.quality != null) stats.push({ label: "Rating", value: `${canyon.quality}/5` });
  if (canyon.numAbseils != null) {
    stats.push({ label: "Abseils", value: String(canyon.numAbseils) });
  }
  if (canyon.longestAbseil != null) {
    stats.push({ label: "Longest drop", value: `${canyon.longestAbseil} m` });
  }
  if (canyon.hours != null) stats.push({ label: "Hours", value: String(canyon.hours) });
  const position = `${canyon.latitude.toFixed(5)}, ${canyon.longitude.toFixed(5)}`;
  const copyPosition = () => {
    // RN core Clipboard: deprecated upstream but still shipped, and it needs no
    // native module — the same copy the waypoint and tapped-point sheets use.
    Clipboard.setString(position);
    notify("Coordinates copied.", "info");
  };
  stats.push({ label: "Position", value: position, wide: true, onPress: copyPosition });

  const openInMapsApp = () => {
    const label = encodeURIComponent(canyon.name);
    const url =
      Platform.OS === "ios"
        ? `maps:0,0?q=${label}@${canyon.latitude},${canyon.longitude}`
        : `geo:${canyon.latitude},${canyon.longitude}?q=${canyon.latitude},${canyon.longitude}(${label})`;
    Linking.openURL(url).catch(() => {
      Alert.alert("Couldn't open maps", "No maps app is available on this device.");
    });
  };

  const confirmDelete = () => {
    const confirm = canyonDeleteConfirm(canyon.name, linkedTrips.length);
    Alert.alert(
      confirm.confirmTitle,
      confirm.confirmBody,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            deleteCanyonLocal(canyon.id)
              .then(onDeleted)
              .catch((err: unknown) => {
                console.error(err);
                notify("Couldn't delete this canyon.", "error");
              });
          },
        },
      ],
    );
  };

  return (
    <View style={styles.screen}>
      <HeroHeader
        eyebrow="Canyon"
        title={canyon.name}
        titleNumberOfLines={2}
        onBack={onBack}
        action={
          isOwner ? (
            <IconButton
              icon="edit-2"
              accessibilityLabel="Edit canyon"
              color={theme.accent}
              filled
              onPress={() => setEditing(true)}
            />
          ) : undefined
        }
      >
        <View style={styles.pillRow}>
          {/* The grade rides as a pill rather than as the eyebrow: the eyebrow
              style is uppercase, and a canyon grade is written with a lowercase
              v/a ("v4a4 III") — upcasing it renders a grade nobody writes. */}
          {grade ? <StatusPill label={grade} tone="outline" /> : null}
          <StatusPill
            label={status === "done" ? tickLabel(linkedTrips.length) : statusMeta.label}
            icon={statusMeta.icon}
            hue={statusMeta.hue}
          />
          {canyon.altNames.length > 0 ? (
            <StatusPill label={`Also ${canyon.altNames.join(", ")}`} tone="outline" />
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
              onPress={() => onShowOnMap(canyon)}
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
          subtitle="Hands the position to your navigation app"
          onPress={openInMapsApp}
        />

        <SectionHeader label={canyon.notes ? "Notes · visible to anyone you share with" : "Notes"} />
        {canyon.notes ? (
          <Text style={styles.notes}>{canyon.notes}</Text>
        ) : (
          <Text style={styles.muted}>Nothing written down.</Text>
        )}

        <SectionHeader
          label={photoCount === 0 ? "Photos & videos" : `Photos & videos · ${photoCount}`}
        />
        <MediaStrip
          kind="media"
          online={online}
          linkedType="canyon"
          linkedId={canyonId}
          media={attachments}
          emptyHint="No photos yet."
          onFailed={(text) => notify(text, "error")}
        />

        <SectionHeader label={routeCount === 0 ? "Routes" : `Routes · ${routeCount}`} />
        {/* One route per canyon — the API enforces it, so the UI has to as well
            (see `limit` in MediaStrip).

            NOT BUILT YET: the web has a map layer toggle that draws every
            canyon's route at once (`showCanyonTracks` in LayersPanel +
            `GET /canyons/tracks`). The mobile map has no equivalent; a tap here
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
              One route per canyon.
            </Text>
          </>
        ) : (
          <MediaStrip
            kind="track"
            online={online}
            limit={1}
            linkedType="canyon"
            linkedId={canyonId}
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

        {/* Waypoints linked to this canyon — the carpark, the campsite, the
            exit. Part of the SHARED record (a linked waypoint follows
            canyon-level media), so unlike the trips below this section renders
            for a recipient too; theirs are read-only, which their own detail
            sheet says. Coordinates stay off the rows — this is a list. */}
        <SectionHeader
          label={
            linkedWaypoints.length === 0
              ? "Waypoints"
              : `Waypoints · ${linkedWaypoints.length}`
          }
        />
        {linkedWaypoints.length === 0 ? (
          <Text style={styles.muted}>
            {isOwner
              ? "Link a waypoint to this canyon from the waypoint's own sheet on the map."
              : "No waypoints on this canyon."}
          </Text>
        ) : (
          linkedWaypoints.map((waypoint) => {
            const symbol = waypointSymbol(waypoint);
            return (
              <Row
                key={waypoint.id}
                icon={symbol.icon}
                hue={symbol.color}
                title={waypoint.name}
                subtitle={
                  waypoint.tags.length > 0 ? waypoint.tags.join(" · ") : undefined
                }
                onPress={() => onShowWaypointOnMap?.(waypoint)}
              />
            );
          })
        )}

        {/* Your own history here — the half a "done" badge can't tell you. Only
            ever your own trips: another person's visits to a canyon they shared
            with you are theirs, and never reach this device. */}
        <SectionHeader
          label={linkedTrips.length === 0 ? "Your trips" : `Your trips · ${linkedTrips.length}`}
        />
        {linkedTrips.length === 0 ? (
          <Text style={styles.muted}>
            {isOwner
              ? "No trips logged here yet."
              : "You haven't logged a trip here. Logging one adds it to your own logbook."}
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

        {isOwner ? (
          <>
            <CanyonSharingSection
              canyonId={canyonId}
              canyonName={canyon.name}
              online={online}
              openRequest={shareOpenRequest}
              onShareRequested={() => setShareOpenRequest((n) => n + 1)}
            />
            <SectionHeader label="Danger zone" />
            <Row
              icon="trash-2"
              hue={theme.warning}
              title="Delete canyon"
              onPress={confirmDelete}
            />
          </>
        ) : null}
      </ScrollView>

      <CanyonEditSheet
        visible={editing}
        canyon={canyon}
        onClose={() => setEditing(false)}
        onSaved={(text) => notify(text, "info")}
        onFailed={(text) => notify(text, "error")}
      />

      <TripEditSheet
        online={online}
        visible={logging}
        canyons={canyonsQuery.data ?? []}
        initialCanyons={[{ id: canyon.id, name: canyon.name }]}
        existingTypes={distinctTripTypes(trips.data ?? [])}
        onClose={() => setLogging(false)}
        onSaved={(text) => notify(text, "info")}
        onFailed={(text) => notify(text, "error")}
      />

      {/* Changing what fills the route slot, from the canyon it belongs to —
          the same two verbs the route's own options offer, where the user is
          looking at the slot rather than at the route. */}
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
            title="Unlink from this canyon"
            subtitle="The route itself is kept"
            icon="link-2"
            hue={theme.warning}
            onPress={() => {
              const target = linkedRoute;
              setRouteSlotMenu(false);
              if (!target) return;
              updateRouteLocal(target.id, { canyonId: null })
                .then(() => notify("Route unlinked.", "info"))
                .catch((err: unknown) => {
                  console.error(err);
                  notify(messageFromError(err, "Couldn't unlink that route."), "error");
                });
            }}
          />
        </View>
      </BottomSheet>

      {/* Every way of filling this canyon's one route slot, from the empty
          slot AND from the replace row above — one panel, one displacement
          decision (canyons/routeSlot.ts). */}
      <AddWaySheet
        canyonId={canyonId}
        canyonName={canyon.name}
        media={attachments}
        visible={addingWay}
        onClose={() => setAddingWay(false)}
        onDrawRoute={onDrawRoute ? () => onDrawRoute(canyonId) : undefined}
        onInfo={(text) => notify(text, "info")}
        onError={(text) => notify(text, "error")}
      />

      <Toast message={toast} onDismissed={() => setToast(null)} />
    </View>
  );
}

/**
 * Per-canyon sharing — owner-only, and online-only: the grant/revoke actions hit
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
function CanyonSharingSection({
  canyonId,
  canyonName,
  online,
  openRequest,
  onShareRequested,
}: {
  canyonId: string;
  canyonName: string;
  online: boolean;
  openRequest: number;
  onShareRequested: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);

  // THE sharing panel, identical to the one Saved, the route sheet, the track
  // sheet and the map's waypoint sheet render. Only the endpoints (canyons keep
  // their own — the hybrid share model lives behind them) and the sentence are
  // canyon-specific, and both are arguments to the same hook.
  const { title, body, sharing } = useSharePanel({
    target: { kind: "canyon", canyonId },
    itemLabel: canyonName,
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
  return trips === 1 ? "Done · 1 trip" : `Done · ${trips} trips`;
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
