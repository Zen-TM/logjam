// The slope bands, edited from the Terrain tab of the layers sheet: the same
// table as Logjam Web's, driven by the same edits (`@logjam/shared`). Every
// editable number is a boundary, so a gap or an overlap cannot be made.
//
// An edit is drawn and kept on the phone at once, then sent to the account
// once the user pauses. There is no outbox for it: account preferences are
// plain `PATCH /users/me` writes (as the theme and the other settings), so a
// send that fails says so and the edit stays on this phone.
import { useEffect, useMemo, useState } from "react";
import { Text, TextInput, View } from "react-native";
import {
  insertSlopeBand,
  MAP_TERRAIN,
  messageFromError,
  nextSlopeBandsEdit,
  removeSlopeBand,
  rgbaCssFromHex,
  setSlopeScale,
  setSlopeScaleColour,
  setSlopeThreshold,
  setSlopeUpper,
  slopeBandsError,
  slopeBoundaryRange,
  slopeScale,
  DEFAULT_SLOPE_SCALE,
  SLOPE_SCALE_COLOURS,
  type SlopeBand,
  type SlopeBandsEdit,
} from "@logjam/shared";

import { apiFetch } from "../api/apiFetch";
import { fetchCurrentUser, useApiQuery } from "../api/queries";
import type { TUser } from "../api/types";
import { useAccountState } from "../auth/AccountStateContext";
import { radius, spacing, makeStyles, useTheme } from "../theme";
import { Button, ColourField, FieldError, IconButton } from "../ui";
import {
  holdAccountSlopeBands,
  keepEditedSlopeBands,
  useSlopeBands,
} from "./slopeBandsPreference";

/** The user pauses, then the account hears: not a request per step of a number. */
const SEND_DELAY_MS = 800;

const SEND_FAILED =
  "Saved on this phone, but it didn't reach your account. Logjam Web will not show it yet.";

/**
 * The bands as the editor holds them. Edits reach the map and the phone as
 * they are made (the last that is valid), and the account after a pause.
 */
function useSlopeBandsEdit() {
  const { accountState } = useAccountState();
  const signedIn = accountState !== "guest";
  // `/users/me` is cached for a minute in apiFetch, so this is no extra trip.
  const user = useApiQuery(
    fetchCurrentUser,
    "Couldn't load your settings.",
    signedIn,
  );
  const userId = signedIn ? (user.data?.id ?? null) : null;

  const kept = useSlopeBands();
  const [edit, setEdit] = useState<SlopeBandsEdit | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const lastValid = edit?.lastValid ?? null;

  useEffect(() => {
    if (!lastValid) return;
    keepEditedSlopeBands(lastValid);
    if (userId == null) return;
    holdAccountSlopeBands(userId);
    const timer = setTimeout(() => {
      apiFetch<TUser>("/users/me", {
        method: "PATCH",
        body: { slopeBands: lastValid },
      })
        .then(() => {
          holdAccountSlopeBands(null);
          setSendError(null);
        })
        .catch((err: unknown) => {
          console.error(messageFromError(err, "Couldn't save slope bands."));
          setSendError(SEND_FAILED);
        });
    }, SEND_DELAY_MS);
    return () => clearTimeout(timer);
  }, [lastValid, userId]);

  return {
    bands: edit?.bands ?? kept,
    setBands: (bands: SlopeBand[]) =>
      setEdit((prev) => nextSlopeBandsEdit(prev, bands)),
    sendError,
  };
}

/** The editor, as the layers sheet shows it in place of the tabs. */
export function SlopeBandsEditor() {
  const styles = useStyles();
  const { bands, setBands, sendError } = useSlopeBandsEdit();
  const scale = slopeScale(bands);
  const error = slopeBandsError(bands);
  const add = (position: number) => {
    const next = insertSlopeBand(bands, position);
    if (next) setBands(next);
  };

  return (
    <View style={styles.body}>
      <Text style={styles.intro}>{MAP_TERRAIN.copy.slopeBandsIntro}</Text>

      <ColourField
        label="Shallowest colour"
        palette={SLOPE_SCALE_COLOURS}
        value={scale.start.slice(0, 7)}
        onChange={(rgb) => setBands(setSlopeScaleColour(bands, "start", rgb))}
      />
      <ColourField
        label="Steepest colour"
        palette={SLOPE_SCALE_COLOURS}
        value={scale.end.slice(0, 7)}
        onChange={(rgb) => setBands(setSlopeScaleColour(bands, "end", rgb))}
      />
      <Button
        compact
        variant="outlineAccent"
        label="Reset colours"
        onPress={() =>
          setBands(
            setSlopeScale(
              bands,
              DEFAULT_SLOPE_SCALE.start,
              DEFAULT_SLOPE_SCALE.end,
            ),
          )
        }
      />

      <View style={styles.table}>
        <BoundaryRow
          lead="Transparent below"
          label="Transparency threshold in degrees"
          value={bands[0].fromDeg}
          range={slopeBoundaryRange(bands, "threshold")}
          onCommit={(deg) => setBands(setSlopeThreshold(bands, deg))}
          onAdd={insertSlopeBand(bands, 0) ? () => add(0) : undefined}
        />
        {bands.map((band, idx) => (
          <BoundaryRow
            key={idx}
            lead={`${band.fromDeg}° to`}
            label={`Band ${idx + 1} upper angle in degrees`}
            value={band.toDeg}
            range={slopeBoundaryRange(bands, idx)}
            colour={band.colour}
            onCommit={(deg) => setBands(setSlopeUpper(bands, idx, deg))}
            onRemove={
              bands.length > 1
                ? () => setBands(removeSlopeBand(bands, idx))
                : undefined
            }
            onAdd={
              insertSlopeBand(bands, idx + 1) ? () => add(idx + 1) : undefined
            }
          />
        ))}
      </View>

      <FieldError message={error ?? sendError} />
    </View>
  );
}

/** One boundary: the number is the only thing typed; the rest is read. */
function BoundaryRow({
  lead,
  label,
  value,
  range,
  colour,
  onCommit,
  onRemove,
  onAdd,
}: {
  lead: string;
  label: string;
  value: number;
  range: { min: number; max: number };
  /** The band's own colour; absent on the transparency threshold. */
  colour?: string;
  onCommit: (deg: number) => void;
  onRemove?: () => void;
  /** Absent when there is no room (eight bands, or no whole degree left). */
  onAdd?: () => void;
}) {
  const theme = useTheme();
  const styles = useStyles();
  const [draft, setDraft] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const swatch = useMemo(
    () => (colour ? rgbaCssFromHex(colour) : "transparent"),
    [colour],
  );

  const commit = () => {
    if (draft == null) return;
    const deg = Number(draft);
    if (
      draft.trim() !== "" &&
      Number.isInteger(deg) &&
      deg >= range.min &&
      deg <= range.max
    ) {
      setProblem(null);
      if (deg !== value) onCommit(deg);
    } else {
      setProblem(`Use a whole number from ${range.min} to ${range.max}.`);
    }
    setDraft(null);
  };

  return (
    <View>
      <View style={styles.line}>
        <Text style={styles.lead}>{lead}</Text>
        <TextInput
          style={styles.input}
          value={draft ?? String(value)}
          onChangeText={setDraft}
          onBlur={commit}
          onSubmitEditing={commit}
          keyboardType="number-pad"
          returnKeyType="done"
          maxLength={2}
          selectTextOnFocus
          accessibilityLabel={label}
        />
        <Text style={styles.lead}>°</Text>
        <View
          style={[
            styles.swatch,
            { backgroundColor: swatch, borderColor: theme.lineStrong },
          ]}
        />
        <View style={styles.actions}>
          {onRemove ? (
            <IconButton
              icon="delete"
              accessibilityLabel={`Remove ${label.replace(" upper angle in degrees", "")}`}
              onPress={onRemove}
            />
          ) : null}
          <IconButton
            icon="add"
            accessibilityLabel={
              onAdd ? "Add a band here" : "No room for another band here"
            }
            disabled={!onAdd}
            onPress={onAdd ?? (() => undefined)}
          />
        </View>
      </View>
      <FieldError message={problem} />
    </View>
  );
}

const useStyles = makeStyles((theme, textRole) => ({
  body: { gap: spacing(1.5) },
  intro: { ...textRole.body, color: theme.textMuted },
  table: { gap: spacing(0.5) },
  line: { flexDirection: "row", alignItems: "center", gap: spacing(1) },
  lead: { ...textRole.body, color: theme.text },
  input: {
    ...textRole.body,
    color: theme.text,
    backgroundColor: theme.field,
    borderWidth: 1,
    borderColor: theme.lineStrong,
    borderRadius: radius.md,
    paddingVertical: spacing(1),
    paddingHorizontal: spacing(1.5),
    minWidth: spacing(6),
    textAlign: "center",
  },
  swatch: {
    width: spacing(4),
    height: spacing(4),
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  actions: { flexDirection: "row", marginLeft: "auto" },
}));
