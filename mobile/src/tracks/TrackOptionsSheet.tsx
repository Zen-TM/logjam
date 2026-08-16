// The verb list for one recorded track, rendered from `trackActions` — the
// sheet the map opens when a track line is tapped.
//
// Same shape and the same reason as RouteOptionsSheet: the actions have one
// definition in saved/assetActions.ts, and a track reached from the map must
// not be a lesser object than one reached from Saved (DESIGN.md §7). The
// rename is a sub-mode of THIS sheet rather than a second one (§6: never open a
// second sheet — swap the content).
import { useEffect, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { messageFromError } from "@logjam/shared";

import { assetHue, spacing, theme } from "../theme";
import { BottomSheet, RenameForm, Row, Toggle } from "../ui";
import { trackActions } from "../saved/assetActions";
import type { Bbox } from "../saved/bboxOfPoints";
import { ExportUnsupportedError, type ExportFormat } from "../fileExport";
import { updateTrack, type Track } from "./tracksDb";

export function TrackOptionsSheet({
  track,
  visible,
  onClose,
  onShowOnMap,
  onInfo,
  onError,
}: {
  track: Track | null;
  visible: boolean;
  onClose: () => void;
  onShowOnMap: (bbox: Bbox) => void;
  onInfo: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [busy, setBusy] = useState(false);

  // A closed sheet forgets its sub-mode: reopening on the next track must not
  // land in a rename form carrying the last one's name.
  useEffect(() => {
    if (!visible) setRenaming(false);
  }, [visible]);

  if (!track) return null;
  const actions = trackActions(track);

  const close = () => {
    setRenaming(false);
    onClose();
  };

  const save = (format: ExportFormat) => {
    close();
    actions.exportFile?.(format).then(
      (filename) => {
        // Null = the user backed out of the folder picker. Not a failure, and a
        // toast claiming success would be a lie.
        if (filename) onInfo(`Saved ${filename}.`);
      },
      (err: unknown) => {
        if (err instanceof ExportUnsupportedError) {
          onError(err.message);
          return;
        }
        console.error(err);
        onError("Couldn't save that file.");
      },
    );
  };

  return (
    <BottomSheet
      visible={visible}
      // A sub-mode backs out to its parent, not out of the sheet (DESIGN.md §6).
      onClose={renaming ? () => setRenaming(false) : close}
      title={renaming ? "Rename track" : track.name}
    >
      {renaming ? (
        <View style={styles.body}>
          <RenameForm
            initialName={track.name}
            onSubmit={(changed) => {
              if (!changed.name) {
                close();
                return;
              }
              setBusy(true);
              actions
                .rename(changed.name)
                .then(() => close())
                .catch((err: unknown) => {
                  console.error(err);
                  onError(messageFromError(err, "Couldn't rename that."));
                })
                .finally(() => setBusy(false));
            }}
          />
        </View>
      ) : (
        <View style={styles.body}>
          {/* Visibility is the one property of a track that is about the MAP
              rather than the track, so it belongs here rather than only in the
              layers sheet — the user tapped the line to act on it. */}
          <Row
            title="Show on the map"
            icon="eye"
            hue={assetHue.track}
            right={
              <Toggle
                value={track.visible}
                accessibilityLabel={`Show ${track.name}`}
                onValueChange={(next) => {
                  updateTrack(track.id, { visible: next }).catch(console.error);
                }}
              />
            }
          />
          {actions.locatable ? (
            <Row
              title="Zoom to this track"
              icon="map-pin"
              hue={assetHue.track}
              disabled={busy}
              onPress={() => {
                close();
                actions.resolveBbox().then(
                  (bbox) => {
                    if (bbox) onShowOnMap(bbox);
                  },
                  (err: unknown) => console.error(err),
                );
              }}
            />
          ) : null}
          {actions.createRouteFrom ? (
            <Row
              title="Create route from this"
              icon="pen-tool"
              hue={assetHue.route}
              disabled={busy}
              onPress={() => {
                close();
                actions.createRouteFrom?.().then(
                  // RDP always throws points away; saying how many survived is
                  // what stops the user concluding the app lost their track.
                  ({ name, pointCount }) =>
                    onInfo(
                      `Saved “${name}” — ${pointCount} points. The recording is unchanged.`,
                    ),
                  (err: unknown) => {
                    console.error(err);
                    onError(messageFromError(err, "Couldn't make a route from that."));
                  },
                );
              }}
            />
          ) : null}
          {actions.exportFile ? (
            <>
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
            </>
          ) : null}
          <Row
            title="Rename"
            icon="edit-2"
            hue={theme.bonus1}
            disabled={busy}
            onPress={() => setRenaming(true)}
          />
          <Row
            title="Delete track"
            icon="trash-2"
            hue={theme.warning}
            disabled={busy}
            onPress={() => {
              close();
              Alert.alert(actions.delete.confirmTitle, actions.delete.confirmBody, [
                { text: "Keep it", style: "cancel" },
                {
                  text: "Delete",
                  style: "destructive",
                  onPress: () =>
                    actions.delete.run().catch((err: unknown) => {
                      console.error(err);
                      onError("Couldn't delete that track.");
                    }),
                },
              ]);
            }}
          />
        </View>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing(1) },
});
