// The verb list for one recorded track, rendered from `trackActions` — the
// sheet the map opens when a track line is tapped AND the sheet behind Saved's
// three-dots.
//
// ONE component for both, same shape and same reason as RouteOptionsSheet: the
// actions have one definition in saved/assetActions.ts, and a track reached
// from the map must not be a lesser object than one reached from Saved
// (DESIGN.md §7). Rename, Send a copy and the stats are sub-modes of THIS
// sheet rather than second sheets (§6: never open a second sheet — swap the
// content), so no caller can be the surface that forgot one.
//
// `onShowOnMap` is the ONE row that is Saved-only: on the map you are already
// looking at the line you tapped.
import { useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { messageFromError, TRACK_COLORS } from "@logjam/shared";

import { assetHue, radius, spacing, theme, withAlpha } from "../theme";
import { BottomSheet, RenameForm, Row, Toggle } from "../ui";
import { trackActions } from "../saved/assetActions";
import { useCanyonPicker } from "../canyons/useCanyonPicker";
import type { Bbox } from "../saved/bboxOfPoints";
import { ExportUnsupportedError } from "../fileExport";
import { updateTrack, type Track } from "./tracksDb";
import { useSharePanel, useShareRowProps } from "../sharing/SharePanel";
import { useConnectivity } from "../map/connectivity";
import { useElevationProfile } from "../map/useElevationProfile";
import { TrackStatsBody } from "./TrackStatsBody";
import { useTrackDetail } from "./useTrackDetail";

export function TrackOptionsSheet({
  track,
  visible,
  onClose,
  onShowOnMap,
  onContinueRecording,
  onInfo,
  onError,
  allowNetwork = true,
}: {
  track: Track | null;
  visible: boolean;
  onClose: () => void;
  /**
   * Fly the map to this track. Saved-only — the map surface omits it, because
   * the user got here by tapping the line and is already looking at it
   * (DESIGN.md §7: "View on map" is the one row the two surfaces differ by).
   */
  onShowOnMap?: (bbox: Bbox) => void;
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
  /** False in "Simulating offline mode" — the stats sub-mode then reads
   *  elevation only from tiles already on the phone. */
  allowNetwork?: boolean;
}) {
  const [renaming, setRenaming] = useState(false);
  const [showingStats, setShowingStats] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [pickingColor, setPickingColor] = useState(false);
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
      setShowingStats(false);
      setAttaching(false);
      setPickingColor(false);
    }
  }, [visible]);

  // The stats read the whole series back, so they run only while that sub-mode
  // is actually open — the same `enabled` gate `useTrackDetail` exists for
  // (mobile/CLAUDE.md, Battery).
  const { detail, loading, line } = useTrackDetail(
    track?.id ?? null,
    visible && showingStats && track != null,
    track?.durationMs,
  );
  const { profile: demProfile, loading: demLoading } = useElevationProfile(line, {
    allowNetwork,
  });

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

  // THE canyon picker, as a sub-mode of this sheet — the same panel a route's
  // and an import's options render. Called unconditionally, like the share
  // panel above it; with the sub-mode closed it issues nothing.
  const canyonPicker = useCanyonPicker({
    source: "track",
    active: attaching,
    attach: async (canyonId, canyonName) => {
      if (!actions?.createRouteFrom) throw new Error("This track can't become a route.");
      // RDP always throws points away; saying how many survived is what stops
      // the user concluding the app lost their recording.
      const { name, pointCount } = await actions.createRouteFrom(canyonId);
      onInfo(
        `Saved “${name}” — ${pointCount} points — as ${canyonName}'s route. The recording is unchanged.`,
      );
    },
    onDone: () => {
      setAttaching(false);
      onClose();
    },
    onError,
  });

  if (!track || !actions) return null;

  const close = () => {
    setRenaming(false);
    setSending(false);
    setShowingStats(false);
    setAttaching(false);
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

  // Every sub-mode backs out to the verb list; only the list itself closes the
  // sheet (DESIGN.md §6 — a sub-mode swaps the content, it never stacks).
  const leaveSubMode = renaming
    ? () => setRenaming(false)
    : sending
      ? () => setSending(false)
      : showingStats
        ? () => setShowingStats(false)
        : attaching
          ? () => setAttaching(false)
          : null;

  return (
    <BottomSheet
      visible={visible}
      // A sub-mode backs out to its parent, not out of the sheet (DESIGN.md §6).
      onClose={leaveSubMode ?? close}
      // The stats sub-mode keeps the track's own name: it is the same subject,
      // seen as numbers.
      title={
        renaming
          ? "Rename track"
          : sending
            ? share.title
            : attaching
              ? "Attach to a canyon"
              : track.name
      }
      onBack={leaveSubMode ?? undefined}
      footer={sending ? share.footer : undefined}
      header={attaching ? canyonPicker.header : undefined}
    >
      {/* Send a copy REPLACES the verb list, like Rename does and like the
          route and waypoint sheets' Share — a picker rendered between the
          verbs pushes "Delete track" into the middle of the flow. */}
      {sending && actions.sendCopy ? (
        share.body
      ) : attaching ? (
        canyonPicker.body
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
      ) : showingStats ? (
        <View style={styles.body}>
          {/* The stored duration, not the series': a track's recording time is
              wall-clock minus pauses, and the point-derived span stops at the
              last accepted fix (see `recordedDurationMs`). */}
          <TrackStatsBody
            detail={detail}
            loading={loading}
            elapsedMs={track.durationMs}
            demProfile={demProfile}
            demLoading={demLoading}
          />
        </View>
      ) : (
        <View style={styles.body}>
          {/* The one row the two surfaces differ by, and it leads the list. */}
          {onShowOnMap && actions.locatable ? (
            <Row
              title="Show on map"
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
          {/* Visibility is the one property of a track that is about the MAP
              rather than the track, so it belongs here rather than only in the
              layers sheet — the user tapped the line to act on it. Worded as a
              STATE, not as the "Show on map" verb above it: one draws the line,
              the other flies to it, and two rows a word apart would be read as
              the same thing twice. */}
          <Row
            title="Visible on the map"
            icon="eye"
            hue={assetHue.track}
            right={
              <Toggle
                value={track.visible}
                accessibilityLabel={`Show ${track.name} on the map`}
                onValueChange={(next) => {
                  updateTrack(track.id, { visible: next }).catch(console.error);
                }}
              />
            }
          />
          <Row
            title="Colour"
            icon="droplet"
            hue={assetHue.track}
            right={
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Choose track colour"
                accessibilityState={{ expanded: pickingColor }}
                onPress={() => setPickingColor((open) => !open)}
                style={styles.swatchButton}
              >
                <View style={[styles.currentSwatch, { backgroundColor: track.color }]} />
              </Pressable>
            }
            onPress={() => setPickingColor((open) => !open)}
          />
          {pickingColor ? (
            <View style={styles.palette}>
              {TRACK_COLORS.map((swatch) => (
                <Pressable
                  key={swatch}
                  accessibilityRole="button"
                  accessibilityLabel={`Colour ${swatch}`}
                  accessibilityState={{ selected: swatch === track.color }}
                  onPress={() => {
                    setPickingColor(false);
                    actions.setColor?.(swatch).catch((err: unknown) => {
                      console.error(err);
                      onError(messageFromError(err, "Couldn't update track colour."));
                    });
                  }}
                  style={[
                    styles.swatch,
                    { backgroundColor: swatch },
                    swatch === track.color ? styles.swatchSelected : null,
                  ]}
                >
                  {swatch === track.color ? <Text style={styles.swatchTick}>✓</Text> : null}
                </Pressable>
              ))}
            </View>
          ) : null}
          {/* What this track IS, one tap in — a tapped line opens the verbs
              now, and the numbers are behind this row (DESIGN.md §7). */}
          <Row
            title="View stats"
            subtitle="Distance, climb, pace and profiles"
            icon="bar-chart-2"
            hue={assetHue.track}
            disabled={busy}
            onPress={() => setShowingStats(true)}
          />
          {/* The one verb that changes what the phone is DOING rather than
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
          {/* The track is never linked itself — it is an observation, and stays
              one. This creates a route from it and links THAT, which the
              picker says before the fact (routeSlot.ts's promise). */}
          {actions.createRouteFrom ? (
            <Row
              title="Attach to a canyon"
              subtitle="As that canyon's route"
              icon="link"
              hue={assetHue.route}
              disabled={busy}
              onPress={() => setAttaching(true)}
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
  swatchButton: {
    padding: spacing(0.5),
    borderRadius: radius.sm,
    justifyContent: "center",
    alignItems: "center",
  },
  currentSwatch: {
    width: 22,
    height: 22,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: withAlpha(theme.textPrimary, 0.35),
  },
  palette: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing(1),
    paddingHorizontal: spacing(1),
    paddingVertical: spacing(0.5),
  },
  swatch: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  swatchSelected: {
    borderWidth: 2,
    borderColor: theme.textPrimary,
  },
  swatchTick: {
    color: "#ffffff",
    fontWeight: "700",
  },
});
