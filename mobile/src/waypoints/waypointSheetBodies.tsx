// The waypoint sub-mode bodies — tags and canyon links — as sheet CONTENT with
// no sheet of their own.
//
// Two surfaces offer these verbs: the map's WaypointSheet and the Saved tab's
// per-item overflow sheet. Each already owns a BottomSheet, so what they share
// is the body, not the container (the same reason saved/assetActions.ts exists:
// two copies of "what does Tags mean for a waypoint" is how the copy on one of
// them goes stale — DESIGN.md §7).
//
// Every write goes through the caller's `onWrite`, which owns the busy flag and
// the error toast, because the two hosts report failure differently.
import { useMemo } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { WAYPOINT_TAG_SUGGESTIONS } from "@logjam/shared";

import { assetHue, fontSize, spacing, theme } from "../theme";
import { ChipPicker, Row, TextField, type ChipOption } from "../ui";
import { useMirrorCanyons, useMirrorShareCounts } from "../sync/useSyncQueries";
import type { MirrorWaypoint } from "../sync/mirrorStore";
import { linkableCanyons, truncationHint } from "./linkableCanyons";

/**
 * The pinned header for a sub-mode: its explainer and any filter field.
 *
 * Going BACK is not here — it rides on the sheet's title line
 * (`BottomSheet`'s `onBack`), because a sub-mode's title is exactly what you
 * are leaving, and this header is empty for the tag picker.
 */
export function WaypointSubModeHeader({
  hint,
  children,
}: {
  hint?: string;
  children?: React.ReactNode;
}) {
  return (
    <View style={styles.header}>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      {children}
    </View>
  );
}

export function WaypointTagsBody({
  waypoint,
  allWaypoints,
  onWrite,
}: {
  waypoint: MirrorWaypoint;
  /** Every waypoint on the device — the tag vocabulary is what is in use. */
  allWaypoints: MirrorWaypoint[];
  onWrite: (fields: Record<string, unknown>) => void;
}) {
  // Seed list unioned with every tag already in use — there is no tag registry
  // to create or curate, exactly as trip types work.
  const options = useMemo<ChipOption[]>(() => {
    const used = new Set<string>();
    for (const row of allWaypoints) {
      for (const tag of row.tags) used.add(tag);
    }
    for (const tag of WAYPOINT_TAG_SUGGESTIONS) used.add(tag);
    return [...used]
      .sort((a, b) => a.localeCompare(b))
      .map((tag) => ({ value: tag, label: tag }));
  }, [allWaypoints]);

  const toggle = (tag: string) => {
    onWrite({
      tags: waypoint.tags.includes(tag)
        ? waypoint.tags.filter((existing) => existing !== tag)
        : [...waypoint.tags, tag],
    });
  };

  return (
    <View style={styles.body}>
      <ChipPicker
        label="Tags"
        options={options}
        selected={waypoint.tags}
        onToggle={toggle}
        onAdd={(label) => {
          const tag = label.trim();
          // The server rejects case-insensitive duplicates, so a typed tag that
          // is already on this waypoint is a no-op, not an add.
          const existing = waypoint.tags.find(
            (current) => current.toLowerCase() === tag.toLowerCase(),
          );
          if (!tag || existing) return;
          onWrite({ tags: [...waypoint.tags, tag] });
        }}
        addPlaceholder="New tag"
      />
    </View>
  );
}

export function WaypointCanyonsBody({
  waypoint,
  query,
  onWrite,
}: {
  waypoint: MirrorWaypoint;
  /** Filter text, owned by the host so it can live in the pinned header. */
  query: string;
  onWrite: (fields: Record<string, unknown>) => void;
}) {
  const canyons = useMirrorCanyons();
  const shareCounts = useMirrorShareCounts();

  const { visible: owned, hiddenCount } = useMemo(
    () => linkableCanyons(canyons.data ?? [], query),
    [canyons.data, query],
  );
  const truncated = truncationHint(owned.length, hiddenCount);

  const toggle = (canyonId: string, canyonName: string) => {
    const linked = waypoint.canyonIds.includes(canyonId);
    const next = linked
      ? waypoint.canyonIds.filter((id) => id !== canyonId)
      : [...waypoint.canyonIds, canyonId];
    const recipients = shareCounts.data?.[canyonId] ?? 0;
    // Unlinking never needs a warning — it can only narrow visibility.
    if (linked || recipients === 0) {
      onWrite({ canyonIds: next });
      return;
    }
    Alert.alert(
      `${canyonName} is shared`,
      `Linking puts this waypoint — including its position — in the canyon record ${
        recipients === 1 ? "1 person" : `${recipients} people`
      } can already see.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Link anyway", onPress: () => onWrite({ canyonIds: next }) },
      ],
    );
  };

  return (
    <View style={styles.body}>
      {owned.length === 0 ? (
        <Text style={styles.hint}>
          {query ? "No canyon of yours matches that." : "You have no canyons yet."}
        </Text>
      ) : (
        <>
          {owned.map((canyon) => {
            const linked = waypoint.canyonIds.includes(canyon.id);
            return (
              <Row
                key={canyon.id}
                title={canyon.name}
                subtitle={
                  (shareCounts.data?.[canyon.id] ?? 0) > 0 ? "Shared" : undefined
                }
                icon={linked ? "check" : "map-pin"}
                hue={linked ? theme.accent : assetHue.route}
                onPress={() => toggle(canyon.id, canyon.name)}
              />
            );
          })}
          {/* The list is capped and has no scroll of its own, so it says when
              it stopped short rather than just ending. */}
          {truncated ? <Text style={styles.hint}>{truncated}</Text> : null}
        </>
      )}
    </View>
  );
}

/** The pinned canyon filter field, for the host's header slot. */
export function WaypointCanyonFilter({
  value,
  onChangeText,
}: {
  value: string;
  onChangeText: (text: string) => void;
}) {
  return <TextField label="Find a canyon" value={value} onChangeText={onChangeText} />;
}

const styles = StyleSheet.create({
  header: { gap: spacing(1) },
  body: { gap: spacing(1) },
  hint: { color: theme.textMuted, fontSize: fontSize.xs },
});
