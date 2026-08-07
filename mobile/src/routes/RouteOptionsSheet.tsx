// The verb list for one route — the sheet behind Saved's three-dots AND the
// map's "View options".
//
// ONE component for both on purpose. The two surfaces offering different verbs
// for the same object is exactly the drift DESIGN.md §7 is about, and the
// actions themselves already have a single source in saved/assetActions.ts.
// This is that descriptor rendered.
//
// Rename lives in the caller (Saved has a rename form; the map does not need a
// second one), so it is passed in rather than assumed.
import { useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { messageFromError } from "@logjam/shared";

import { assetHue, theme } from "../theme";
import { BottomSheet, Row } from "../ui";
import { routeActions } from "../saved/assetActions";
import type { MirrorRoute } from "../sync/mirrorStore";
import { exportRoute, RouteExportUnsupportedError } from "./routeExport";

export function RouteOptionsSheet({
  route,
  visible,
  onClose,
  onViewStats,
  onShowOnMap,
  onEdit,
  onRename,
  onLinkCanyon,
  onInfo,
  onError,
}: {
  route: MirrorRoute | null;
  visible: boolean;
  onClose: () => void;
  /** Omitted where the stats are already on screen (the map's stats sheet). */
  onViewStats?: () => void;
  onShowOnMap?: () => void;
  onEdit?: () => void;
  onRename?: () => void;
  onLinkCanyon?: () => void;
  onInfo: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  if (!route) return null;
  const actions = routeActions(route);

  const run = (action: () => Promise<unknown>, failure: string) => {
    setBusy(true);
    action()
      .catch((err: unknown) => {
        console.error(err);
        onError(messageFromError(err, failure));
      })
      .finally(() => setBusy(false));
  };

  const save = (format: "gpx" | "kml") => {
    onClose();
    setBusy(true);
    exportRoute(route, format)
      .then((filename) => {
        // Null = the user backed out of the folder picker. Not a failure, and
        // a toast claiming success would be a lie.
        if (filename) onInfo(`Saved ${filename}.`);
      })
      .catch((err: unknown) => {
        if (err instanceof RouteExportUnsupportedError) {
          onError(err.message);
          return;
        }
        console.error(err);
        onError("Couldn't save that file.");
      })
      .finally(() => setBusy(false));
  };

  const confirmDelete = () => {
    onClose();
    Alert.alert(actions.delete.confirmTitle, actions.delete.confirmBody, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () =>
          actions.delete.run().catch((err: unknown) => {
            console.error(err);
            onError("Couldn't delete that route.");
          }),
      },
    ]);
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title={route.name}>
      <View style={styles.body}>
        {onViewStats ? (
          <Row
            title="View stats"
            icon="bar-chart-2"
            hue={assetHue.route}
            disabled={busy}
            onPress={onViewStats}
          />
        ) : null}
        {onShowOnMap && actions.locatable ? (
          <Row
            title="Show on map"
            icon="map-pin"
            hue={assetHue.route}
            disabled={busy}
            onPress={onShowOnMap}
          />
        ) : null}
        {onEdit && actions.editableRouteId ? (
          <Row
            title="Edit points"
            icon="edit-3"
            hue={assetHue.route}
            disabled={busy}
            onPress={onEdit}
          />
        ) : null}
        {actions.reverse ? (
          <Row
            title="Reverse direction"
            icon="repeat"
            hue={assetHue.route}
            disabled={busy}
            onPress={() => {
              onClose();
              run(actions.reverse!, "Couldn't reverse that route.");
            }}
          />
        ) : null}
        {onLinkCanyon && actions.editableRouteId ? (
          <Row
            title={route.canyonId ? "Change linked canyon" : "Link to a canyon"}
            subtitle={
              route.canyonId
                ? undefined
                : "Sharing the canyon shares the route with it"
            }
            icon="link"
            hue={assetHue.route}
            disabled={busy}
            onPress={onLinkCanyon}
          />
        ) : null}
        <Row
          title="Save as GPX"
          icon="download"
          hue={theme.bonus1}
          disabled={busy}
          onPress={() => save("gpx")}
        />
        <Row
          title="Save as KML"
          icon="download"
          hue={theme.bonus1}
          disabled={busy}
          onPress={() => save("kml")}
        />
        {onRename ? (
          <Row
            title="Rename"
            icon="edit-2"
            hue={theme.bonus1}
            disabled={busy}
            onPress={onRename}
          />
        ) : null}
        {/* A route is a synced record, so this removes it from the ACCOUNT —
            "from device" would promise the copy on another phone survives. */}
        <Row
          title="Delete route"
          icon="trash-2"
          hue={theme.warning}
          disabled={busy}
          onPress={confirmDelete}
        />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: 8 },
});
