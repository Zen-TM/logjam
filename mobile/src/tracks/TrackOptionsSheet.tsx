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
import { ExportUnsupportedError } from "../fileExport";
import { updateTrack, type Track } from "./tracksDb";
import { useSharePanel, useShareRowProps } from "../sharing/SharePanel";
import { useConnectivity } from "../map/connectivity";

export function TrackOptionsSheet({
  track,
  visible,
  onClose,
  onShowOnMap,
  onContinueRecording,
  onInfo,
  onError,
}: {
  track: Track | null;
  visible: boolean;
  onClose: () => void;
  onShowOnMap: (bbox: Bbox) => void;
  /**
   * Pick this recording back up. Owned by the MAP rather than by this sheet
   * because starting a recorder needs the location permission prompt, which
   * cannot be raised from an open sheet (DESIGN.md §7 — the bug that made
   * "Take photo" look dead), and because the map is what has to enter
   * recording mode afterwards.
   */
  onContinueRecording: (track: Track) => void;
  onInfo: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  // Rendered in this sheet rather than handed to the caller: this component is
  // the map's track options as well as Saved's, and a callback would have
  // given the verb only to whichever surface remembered to pass it.
  const [sending, setSending] = useState(false);
  const online = useConnectivity() === "online";
  const [busy, setBusy] = useState(false);

  // A closed sheet forgets its sub-mode: reopening on the next track must not
  // land in a rename form carrying the last one's name.
  // EVERY sub-mode resets when the sheet closes. This component stays mounted
  // between openings — `visible` is a prop, not a remount — so a sub-mode left
  // set means the NEXT open lands inside it instead of on the verb list. That
  // shipped: the route sheet opened straight into its share panel, and the
  // options list became unreachable.
  useEffect(() => {
    if (!visible) {
      setRenaming(false);
      setSending(false);
    }
  }, [visible]);

  const shareRowProps = useShareRowProps(online);
  const actions = track ? trackActions(track) : null;
  // THE sharing panel, in its "send a copy" mode — the same component every
  // other surface renders, with the wording the one non-revocable verb needs.
  const share = useSharePanel({
    target: actions?.sendCopy ? { kind: "copy", sendCopy: actions.sendCopy } : null,
    itemLabel: track?.name ?? "",
    online,
    active: sending,
    onSent: (count) => {
      setSending(false);
      onClose();
      onInfo(`Sent a copy to ${count} friend${count === 1 ? "" : "s"}.`);
    },
  });

  if (!track || !actions) return null;

  const close = () => {
    setRenaming(false);
    setSending(false);
    onClose();
  };

  const save = (option: { run: () => Promise<string | null> }) => {
    close();
    option.run().then(
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
      onClose={
        renaming
          ? () => setRenaming(false)
          : sending
            ? () => setSending(false)
            : close
      }
      title={renaming ? "Rename track" : sending ? share.title : track.name}
      onBack={sending ? () => setSending(false) : undefined}
      footer={sending ? share.footer : undefined}
    >
      {/* Send a copy REPLACES the verb list, like Rename does and like the
          route and waypoint sheets' Share — a picker rendered between the
          verbs pushes "Delete track" into the middle of the flow. */}
      {sending && actions.sendCopy ? (
        share.body
      ) : renaming ? (
        <View style={styles.body}>
          <RenameForm
            initialName={track.name}
            onSubmit={(changed) => {
              if (!changed.name) {
                close();
                return;
              }
              setBusy(true);
              // A recording is always this device's own, so both verbs are
              // present; the descriptor types them optional because it also
              // describes assets shared from another account.
              (actions.rename ?? (async () => undefined))(changed.name)
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
          {/* First of the verbs, and above "Zoom to this track", because it is
              the only one that changes what the phone is DOING rather than
              what it is showing. */}
          <Row
            title="Continue recording"
            icon="play-circle"
            hue={assetHue.track}
            disabled={busy}
            onPress={() => {
              close();
              onContinueRecording(track);
            }}
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
          {actions.exports?.map((option) => (
            <Row
              key={option.title}
              title={option.title}
              icon="download"
              hue={theme.bonus1}
              disabled={busy}
              onPress={() => save(option)}
            />
          ))}
          {/* NOT "Share": a recording leaves as a GPX the friend keeps, and
              there is no taking it back. The verb list on a route offers the
              revocable one; these two must never read alike. */}
          {actions.sendCopy ? (
            <Row
              title="Send a copy"
              icon="send"
              hue={theme.bonus1}
              {...shareRowProps}
              disabled={busy || shareRowProps.disabled}
              onPress={() => setSending((open) => !open)}
            />
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
              if (!actions.delete) return;
              const removal = actions.delete;
              Alert.alert(removal.confirmTitle, removal.confirmBody, [
                { text: "Keep it", style: "cancel" },
                {
                  text: "Delete",
                  style: "destructive",
                  onPress: () =>
                    removal.run().catch((err: unknown) => {
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
