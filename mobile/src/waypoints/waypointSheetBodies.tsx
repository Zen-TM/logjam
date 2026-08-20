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
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import type { TextInput } from "react-native";
import {
  WAYPOINT_TAG_SUGGESTIONS,
  validateWaypointPayload,
} from "@logjam/shared";

import { assetHue, fontSize, spacing, theme } from "../theme";
import { Button, ChipPicker, ErrorBanner, Row, TextField, type ChipOption } from "../ui";
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


/**
 * Name, position and notes for one waypoint.
 *
 * This replaces a name+notes `RenameForm`, which meant a waypoint's POSITION —
 * the only field it cannot exist without — was the one thing about it nobody
 * could correct. A pin dropped with a thumb on a moving map is off by whatever
 * the map's scale made it off by, and the fix used to be delete-and-drop-again.
 *
 * The coordinates share a line because they are one value read as a pair, and
 * splitting them down a column reads as two unrelated numbers.
 *
 * Validated by `validateWaypointPayload` — the same predicate the API applies —
 * BEFORE anything is queued, so a bad number is a message here rather than a
 * dead push in the outbox whose reason the user never sees (the rule
 * CanyonEditSheet already follows).
 */
export function WaypointEditBody({
  waypoint,
  onSubmit,
}: {
  waypoint: MirrorWaypoint;
  /**
   * Called with only what CHANGED, ready for an outbox patch. Not called at all
   * when nothing moved; closing the mode is the caller's job either way.
   */
  onSubmit: (changed: {
    name?: string;
    notes?: string | null;
    latitude?: number;
    longitude?: number;
  }) => void;
}) {
  const [name, setName] = useState(waypoint.name);
  const [notes, setNotes] = useState(waypoint.notes ?? "");
  // Text, not numbers: a half-typed "-33." is not a number and must not be
  // rewritten under the cursor.
  const [latitude, setLatitude] = useState(String(waypoint.latitude));
  const [longitude, setLongitude] = useState(String(waypoint.longitude));
  const [invalid, setInvalid] = useState<string | null>(null);
  const nameRef = useRef<TextInput>(null);

  // The sheet is already open and focused, so focus lands on the next frame —
  // `autoFocus` runs before the field attaches (DESIGN.md §6).
  useEffect(() => {
    const frame = requestAnimationFrame(() => nameRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  const commit = () => {
    setInvalid(null);
    const changed: {
      name?: string;
      notes?: string | null;
      latitude?: number;
      longitude?: number;
    } = {};

    // An empty name is a no-op, not a clear: a waypoint requires one, and the
    // server would reject it after the sheet had already closed.
    const trimmedName = name.trim();
    if (trimmedName && trimmedName !== waypoint.name) changed.name = trimmedName;

    const trimmedNotes = notes.trim();
    if (trimmedNotes !== (waypoint.notes ?? "")) changed.notes = trimmedNotes || null;

    // Compared as TEXT against the stored value's own rendering, so retyping
    // the same number is not an edit and 6 vs 6.0 does not queue a write.
    if (latitude.trim() !== String(waypoint.latitude)) {
      changed.latitude = Number(latitude.trim());
    }
    if (longitude.trim() !== String(waypoint.longitude)) {
      changed.longitude = Number(longitude.trim());
    }

    const problem = validateWaypointPayload(changed, { requireCore: false });
    if (problem) {
      setInvalid(problem);
      return;
    }
    if (Object.keys(changed).length > 0) onSubmit(changed);
    else onSubmit({});
  };

  return (
    <View style={styles.body}>
      {invalid ? <ErrorBanner message={invalid} /> : null}
      <TextField
        label="Name"
        value={name}
        onChangeText={setName}
        inputRef={nameRef}
        returnKeyType="next"
      />
      <View style={styles.coordRow}>
        <View style={styles.coordField}>
          <TextField
            label="Latitude"
            value={latitude}
            onChangeText={setLatitude}
            keyboardType="numbers-and-punctuation"
          />
        </View>
        <View style={styles.coordField}>
          <TextField
            label="Longitude"
            value={longitude}
            onChangeText={setLongitude}
            keyboardType="numbers-and-punctuation"
          />
        </View>
      </View>
      <TextField label="Notes" value={notes} onChangeText={setNotes} multiline />
      <Button label="Save" icon="check" onPress={commit} />
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
  coordRow: { flexDirection: "row", gap: spacing(1) },
  coordField: { flex: 1 },
  hint: { color: theme.textMuted, fontSize: fontSize.xs },
});
