// Fill a canyon's route slot with a route the user already drew.
//
// The mirror image of LinkCanyonSheet: same rule, opposite direction. A canyon
// holds ONE route, and until now it could hold two different kinds of one —
// a Route row (`Route.canyonId`, unique) and a track MEDIA file
// (assertCanyonTrackSlotFree, 409). Two slots, neither aware of the other. To
// the user there is one "the route for this canyon", so this treats both as
// occupants of it and says plainly what will be displaced:
//
//   - another drawn route  → unlinked, KEPT as a standalone route (recoverable)
//   - an attached GPX/KML  → deleted (NOT recoverable, so it says so)
//
// The link is written first and the file removed second: if the delete fails
// the canyon briefly shows both, which is visible and fixable, where the other
// order could lose the file and not land the link.
import { useMemo, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { formatDistanceM, messageFromError, routeLengthM } from "@logjam/shared";

import { assetHue, fontSize, spacing, theme } from "../theme";
import { BottomSheet, Row, TextField } from "../ui";
import { updateRouteLocal } from "../sync/outbox";
import { useMirrorRoutes } from "../sync/useSyncQueries";
import type { MirrorMedia } from "../sync/mirrorStore";

export function PickRouteSheet({
  canyonId,
  canyonName,
  /** Track media already attached to this canyon — the other kind of occupant. */
  attachedTrack,
  visible,
  onClose,
  onDeleteTrack,
  onInfo,
  onError,
}: {
  canyonId: string;
  canyonName: string;
  attachedTrack: MirrorMedia | null;
  visible: boolean;
  onClose: () => void;
  onDeleteTrack: () => Promise<unknown>;
  onInfo: (message: string) => void;
  onError: (message: string) => void;
}) {
  const routes = useMirrorRoutes();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (routes.data ?? [])
      // A route shared with you belongs to someone else; the API refuses the
      // write, so it must not be offered.
      .filter((route) => route.syncRole !== "shared")
      .filter((route) => !needle || route.name.toLowerCase().includes(needle));
  }, [routes.data, query]);

  const linkedRoute = (routes.data ?? []).find(
    (route) => route.canyonId === canyonId,
  );

  const link = (routeId: string) => {
    setBusy(true);
    updateRouteLocal(routeId, { canyonId })
      .then(async () => {
        if (attachedTrack) await onDeleteTrack();
        onInfo("Route attached to this canyon.");
        onClose();
      })
      .catch((err: unknown) => {
        console.error(err);
        onError(messageFromError(err, "Couldn't attach that route."));
      })
      .finally(() => setBusy(false));
  };

  const pick = (routeId: string, routeName: string) => {
    if (attachedTrack) {
      Alert.alert(
        `${canyonName} already has a route`,
        `The attached file “${attachedTrack.filename ?? "route"}” will be deleted and replaced by “${routeName}”. That can't be undone.`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Replace", style: "destructive", onPress: () => link(routeId) },
        ],
      );
      return;
    }
    if (linkedRoute && linkedRoute.id !== routeId) {
      Alert.alert(
        `${canyonName} already has a route`,
        `“${linkedRoute.name}” will be unlinked and kept as a standalone route.`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Replace", onPress: () => link(routeId) },
        ],
      );
      return;
    }
    link(routeId);
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Use a route you drew"
      header={
        <View style={styles.header}>
          <Text style={styles.hint}>
            Anyone you share a canyon with can see linked routes.
          </Text>
          <TextField label="Find a route" value={query} onChangeText={setQuery} />
        </View>
      }
    >
      <View style={styles.body}>
        {matches.length === 0 ? (
          <Text style={styles.hint}>
            {query
              ? "No route of yours matches that."
              : "You haven't drawn any routes yet."}
          </Text>
        ) : (
          matches.map((route) => (
            <Row
              key={route.id}
              title={route.name}
              subtitle={
                route.canyonId === canyonId
                  ? "Already this canyon's route"
                  : formatDistanceM(routeLengthM(route.points))
              }
              icon={route.canyonId === canyonId ? "check" : "edit-3"}
              hue={route.canyonId === canyonId ? theme.accent : assetHue.route}
              disabled={busy || route.canyonId === canyonId}
              onPress={() => pick(route.id, route.name)}
            />
          ))
        )}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing(1) },
  body: { gap: spacing(1) },
  hint: { color: theme.textMuted, fontSize: fontSize.xs },
});
