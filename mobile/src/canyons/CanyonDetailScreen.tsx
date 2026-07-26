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
  ActivityIndicator,
  Alert,
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
import { fetchCurrentUser, useApiQuery } from "../api/queries";
import { tripTitle } from "../api/tripTitle";
import { useConnectivity } from "../map/connectivity";
import { MediaStrip } from "../media/MediaStrip";
import { fontSize, fontWeight, lineHeight, radius, spacing, surface, theme } from "../theme";
import type { MirrorCanyon, MirrorTrip } from "../sync/mirrorStore";
import { deleteCanyonLocal } from "../sync/outbox";
import {
  useMirrorCanyon,
  useMirrorCanyons,
  useMirrorMedia,
  useMirrorTrips,
} from "../sync/useSyncQueries";
import {
  BottomSheet,
  Button,
  EmptyState,
  ErrorBanner,
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
import { CANYON_STATUS_META, canyonStatus } from "./canyonMeta";

export function CanyonDetailScreen({
  canyonId,
  onBack,
  onOpenTrip,
  onShowOnMap,
  onDeleted,
}: {
  canyonId: string;
  onBack: () => void;
  /** Opens one of the viewer's own logged trips at this canyon. */
  onOpenTrip: (trip: MirrorTrip) => void;
  onShowOnMap: (canyon: MirrorCanyon) => void;
  /** The canyon this screen is showing is gone — leave, don't render a husk. */
  onDeleted: () => void;
}) {
  const query = useMirrorCanyon(canyonId);
  const media = useMirrorMedia("canyon", canyonId);
  const trips = useMirrorTrips();
  const canyonsQuery = useMirrorCanyons();
  const online = useConnectivity() === "online";
  const userQuery = useApiQuery(fetchCurrentUser, "Couldn't load your fields.");

  const [editing, setEditing] = useState(false);
  const [logging, setLogging] = useState(false);
  const [shareOpenRequest, setShareOpenRequest] = useState(0);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const toastNonce = useRef(0);
  const notify = useCallback((text: string, tone: "info" | "error") => {
    toastNonce.current += 1;
    setToast({ text, tone, nonce: toastNonce.current });
  }, []);

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
  const routeCount = attachments.filter(
    (item) => mediaCategory(item.mediaType) === "track",
  ).length;

  // Canyon custom fields are their own account-level definition list (the web's
  // canyonCustomFields), separate from trip fields.
  const fieldDefs = userQuery.data?.uiPreferences?.canyonCustomFields ?? [];
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
  stats.push({
    label: "Position",
    value: `${canyon.latitude.toFixed(5)}, ${canyon.longitude.toFixed(5)}`,
  });

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
    Alert.alert(
      `Delete ${canyon.name}?`,
      [
        "The canyon, its notes and its photos are removed from this device and from your account.",
        linkedTrips.length > 0
          ? `${linkedTrips.length} logged ${linkedTrips.length === 1 ? "trip" : "trips"} will stay, but lose the link to it.`
          : null,
        "This can't be undone.",
      ]
        .filter(Boolean)
        .join(" "),
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
          <Text style={styles.muted}>
            {isOwner
              ? "Nothing written down. Access, water, escape routes — the things you'd want next time."
              : "The owner hasn't written any notes."}
          </Text>
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
          emptyHint="No photos yet — the camera works with no signal."
          onFailed={(text) => notify(text, "error")}
        />

        <SectionHeader label={routeCount === 0 ? "Routes" : `Routes · ${routeCount}`} />
        <MediaStrip
          kind="track"
          online={online}
          linkedType="canyon"
          linkedId={canyonId}
          media={attachments}
          emptyHint="Attach a .gpx or .kml so the route is on the map next time."
          onFailed={(text) => notify(text, "error")}
        />

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
 * `openRequest` lets a caller trigger the picker without lifting this
 * component's load/share/unshare state out of it.
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
  const [recipients, setRecipients] = useState<CanyonShareRecipient[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [friends, setFriends] = useState<Friend[] | null>(null);

  const load = useCallback(async () => {
    try {
      setRecipients(await getCanyonShares(canyonId));
      setLoadFailed(false);
    } catch (err) {
      // The rest of this screen renders offline; sharing needs the network.
      // Degrade to a note rather than a hard error — never block the read view.
      // The copy is ours, not the error's: interpolating a server message into a
      // row is how a canyon name reaches a screenshot (DESIGN.md §11).
      console.error(err);
      setLoadFailed(true);
    }
  }, [canyonId]);

  useEffect(() => {
    if (online) void load();
  }, [load, online]);

  const openPicker = useCallback(async () => {
    setActionError(null);
    setPickerOpen(true);
    if (friends === null) {
      try {
        setFriends(await getFriends());
      } catch (err) {
        console.error(err);
        setActionError(messageFromError(err, "Couldn't load friends."));
      }
    }
  }, [friends]);

  // openRequest starts at 0; only act once the caller has bumped it.
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
        console.error(err);
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
        `They'll lose access to ${canyonName} and its photos.`,
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
                .catch((err: unknown) => {
                  console.error(err);
                  setActionError(messageFromError(err, "Couldn't unshare canyon."));
                })
                .finally(() => setBusyId(null));
            },
          },
        ],
      );
    },
    [canyonId, canyonName, load],
  );

  const sharedIds = new Set((recipients ?? []).map((r) => r.sharedWith.id));
  const shareable = (friends ?? []).filter((f) => !sharedIds.has(f.id));

  return (
    <>
      <SectionHeader
        label={
          recipients && recipients.length > 0
            ? `Shared with · ${recipients.length}`
            : "Shared with"
        }
      />
      {actionError ? <ErrorBanner message={actionError} /> : null}
      {(recipients ?? []).map((recipient) => (
        <Row
          key={recipient.id}
          icon="user"
          title={recipient.sharedWith.username}
          right={
            busyId === recipient.id ? (
              <ActivityIndicator color={theme.accent} />
            ) : (
              <IconButton
                icon="x"
                color={theme.warning}
                accessibilityLabel={`Stop sharing with ${recipient.sharedWith.username}`}
                onPress={() => confirmUnshare(recipient)}
              />
            )
          }
        />
      ))}

      {/* Offline this door is closed WITH THE REASON in place of its subtitle
          (DESIGN.md §10) rather than hidden, so the feature doesn't appear to
          come and go. */}
      <Row
        icon="share-2"
        title="Share with a friend"
        subtitle={
          !online
            ? "Needs a connection"
            : loadFailed
              ? "Can't reach your account right now"
              : recipients === null
                ? "Loading…"
                : recipients.length === 0
                  ? "Not shared with anyone yet"
                  : undefined
        }
        disabled={!online || loadFailed}
        onPress={onShareRequested}
      />

      <BottomSheet
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title={`Share ${canyonName} with`}
      >
        {actionError ? <ErrorBanner message={actionError} /> : null}
        {friends === null ? (
          <ActivityIndicator color={theme.accent} style={styles.spinner} />
        ) : shareable.length === 0 ? (
          <Text style={styles.muted}>
            {friends.length === 0
              ? "No friends yet — add friends from the More tab."
              : "All your friends already have access."}
          </Text>
        ) : (
          <View style={styles.sheetBody}>
            {shareable.map((friend) => (
              <Row
                key={friend.id}
                icon="user"
                title={friend.username}
                onPress={busyId === null ? () => void share(friend) : undefined}
                right={
                  busyId === friend.id ? <ActivityIndicator color={theme.accent} /> : undefined
                }
              />
            ))}
          </View>
        )}
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
