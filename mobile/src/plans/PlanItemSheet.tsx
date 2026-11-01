// A plan place's, way's or file's ⋯ (`planItemVerbs`, the declaration Logjam
// Web's menu renders from), and the form behind Edit, as modes of one sheet
// (mobile/DESIGN.md §4). Download is left out: a file opens in the viewer
// from its row. Save a copy is the caller's sheet, opened once this one has
// closed. Any refused write fetches the plan again and fails
// the save with the API's sentence over the form, which keeps what was typed
// and shows the plan's value under a field the plan changed meanwhile
// (`tripPlanInPlanNow`); an item gone from the plan closes the sheet.
import { Fragment, useRef, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import {
  ApiError,
  itemFieldDefs,
  itemPatch,
  itemWords,
  ITEM_ATTR,
  mediaDisplayName,
  messageFromError,
  planItemDeleteConfirm,
  planItemVerbs,
  tripPlanAdoptTheirs,
  tripPlanInPlanNow,
  tripPlanSame,
  tripPlanTheirsChanged,
  SYSTEM_FIELD_DEFS,
  TRIP_PLAN_PAGE,
  validatePlacePayload,
  type ItemWords,
  type PlanItemVerbId,
  type TripPlanItem,
  type TripPlanRole,
} from "@logjam/shared";

import { unavailableReasonText } from "../auth/capabilities";
import { CustomFieldValueInputs } from "../customFields/CustomFieldValues";
import { coerceCustomFields } from "../customFields/fieldValueCoercion";
import { makeStyles, muted, spacing, useTheme } from "../theme";
import {
  BottomSheet,
  Button,
  ErrorBanner,
  FormStack,
  Row,
  SectionHeader,
  TextField,
} from "../ui";
import { deletePlanItem, patchPlanItem } from "./plansApi";
import { afterPlanWrite } from "./plansCache";

const copy = TRIP_PLAN_PAGE.copy;
const OFFLINE = unavailableReasonText("needs-connection");

export const itemTitle = (item: TripPlanItem) =>
  item.kind === "media" ? mediaDisplayName(item.item) : item.name;

export function PlanItemSheet({
  item,
  current,
  planId,
  role,
  me,
  archived,
  online,
  onClose,
  onSave,
  onInfo,
  onError,
}: {
  /** The item whose ⋯ this is; null while closed. */
  item: TripPlanItem | null;
  /** That item as the plan now has it, once fetched again. */
  current: TripPlanItem | null;
  planId: string;
  role: TripPlanRole;
  /** The caller's user id: a member changes only what they added. */
  me: string | null;
  archived: boolean;
  online: boolean;
  onClose: () => void;
  /** Save a copy: the caller opens its sheet. */
  onSave: (item: TripPlanItem) => void;
  onInfo: (message: string) => void;
  onError: (message: string) => void;
}) {
  const theme = useTheme();
  const styles = useStyles();
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<ItemWords>({ name: "", notes: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Reset for each item the sheet opens on.
  const [shownFor, setShownFor] = useState<string | null>(null);
  // What a Save compares against: the item as opened, then as the plan was
  // fetched again. `opened` is what "changed meanwhile" is measured from.
  const [seen, setSeen] = useState<TripPlanItem | null>(null);
  const [opened, setOpened] = useState<ItemWords | null>(null);
  const [moved, setMoved] = useState(false);
  const key = item ? `${item.kind}:${item.id}` : null;
  if (key !== shownFor) {
    setShownFor(key);
    setEditing(false);
    setError(null);
    setSeen(item);
    setMoved(false);
    setOpened(item ? itemWords(item) : null);
    if (item) setValues(itemWords(item));
  } else if (seen && current && !tripPlanSame(current, seen)) {
    setValues(
      tripPlanAdoptTheirs(itemWords(seen), values, itemWords(current)).values,
    );
    setSeen(current);
    setMoved(true);
  }
  const nowWords = current ? itemWords(current) : null;
  /** The plan's words under a field the user edited and the plan changed. */
  const theirs = (field: string) =>
    moved &&
    nowWords &&
    opened &&
    tripPlanTheirsChanged([field], values, nowWords, opened)
      ? tripPlanInPlanNow(nowWords[field])
      : undefined;
  // A Save a copy is parked and opened from `onClosed`: a sheet can't open
  // while this one is closing.
  const parked = useRef<(() => void) | null>(null);

  const verbs = item
    ? planItemVerbs(
        role,
        { kind: item.kind, mine: item.addedBy?.id === me },
        { archived },
      ).filter((verb) => verb.id !== "download")
    : [];

  const confirmDelete = (target: TripPlanItem) => {
    const confirm = planItemDeleteConfirm(
      itemTitle(target),
      target.kind === "place" ? target.media.length : 0,
    );
    Alert.alert(confirm.confirmTitle, confirm.confirmBody, [
      { text: "Cancel", style: "cancel" },
      {
        text: confirm.confirmLabel,
        style: "destructive",
        onPress: () => {
          deletePlanItem(planId, target.kind, target.id)
            .then(() => afterPlanWrite(planId))
            .then(() => onInfo(copy.itemDeleted))
            .catch((err: unknown) => {
              if (err instanceof ApiError) void afterPlanWrite(planId);
              onError(messageFromError(err, copy.itemDeleteFailed));
            });
        },
      },
    ]);
  };

  const run = (id: PlanItemVerbId, target: TripPlanItem) => {
    if (id === "edit") return setEditing(true);
    if (id === "save") parked.current = () => onSave(target);
    onClose();
    if (id === "delete") confirmDelete(target);
  };

  async function submit(target: TripPlanItem) {
    if (target.kind === "place") {
      const defs = itemFieldDefs(target);
      const attrs = Object.fromEntries(
        defs.map((def) => [def.key, values[ITEM_ATTR + def.key] ?? ""]),
      );
      const blank = (text: string) => text.trim() === "";
      const problem = validatePlacePayload(
        {
          latitude: blank(values.latitude)
            ? undefined
            : Number(values.latitude),
          longitude: blank(values.longitude)
            ? undefined
            : Number(values.longitude),
          elevation: blank(values.elevation) ? null : Number(values.elevation),
          fieldValues: Object.fromEntries(
            Object.entries(coerceCustomFields(attrs, defs)).filter(
              ([, value]) => value != null,
            ),
          ),
        },
        { requireCoords: true, defs: [...SYSTEM_FIELD_DEFS, ...defs] },
      );
      if (problem) return setError(problem);
    }
    const base = seen ?? target;
    const patch = itemPatch(base, values);
    if (!patch) return onClose();
    setBusy(true);
    try {
      await patchPlanItem(planId, base.kind, base.id, patch);
      await afterPlanWrite(planId);
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        // Changed, gone, or no longer theirs: fetched again, so the form
        // shows the plan's words; gone or not theirs closes it.
        await afterPlanWrite(planId);
        const message = messageFromError(err, copy.itemSaveFailed);
        if (err.status === 409) setError(message);
        else {
          onClose();
          onError(message);
        }
      } else setError(messageFromError(err, copy.itemSaveFailed));
    } finally {
      setBusy(false);
    }
  }

  const attrDefs = item?.kind === "place" ? itemFieldDefs(item) : [];
  const set = (next: Record<string, string>) => {
    setValues((was) => ({ ...was, ...next }));
    setError(null);
  };
  // Inside Edit, every way out is back to the ⋯, not away with what was typed.
  const back = editing ? () => setEditing(false) : undefined;
  return (
    <BottomSheet
      visible={item !== null}
      onClose={back ?? onClose}
      onBack={back}
      closable={!busy}
      onClosed={() => {
        const open = parked.current;
        parked.current = null;
        open?.();
      }}
      title={editing ? copy.itemEdit : item ? itemTitle(item) : ""}
      footer={
        editing && item ? (
          <FormStack>
            {error ? <ErrorBanner message={error} /> : null}
            <Button
              label={copy.sectionSave}
              icon="done"
              loading={busy}
              disabled={!online}
              disabledReason={OFFLINE}
              onPress={() => void submit(item)}
            />
            {/* The button only dims: the words go under it (ui/Button.tsx). */}
            {online ? null : <Text style={styles.note}>{OFFLINE}</Text>}
          </FormStack>
        ) : undefined
      }
    >
      {item && !editing ? (
        <View style={styles.verbs}>
          {verbs.map((verb, at, all) => (
            <Fragment key={verb.id}>
              {verb.separated && at > 0 && !all[at - 1].separated ? (
                <View style={styles.rule} />
              ) : null}
              <Row
                icon={verb.icon}
                hue={verb.danger ? theme.warning : undefined}
                title={verb.label}
                subtitle={online ? verb.disabledReason : OFFLINE}
                disabled={!online || verb.disabledReason != null}
                onPress={() => run(verb.id, item)}
              />
            </Fragment>
          ))}
        </View>
      ) : null}
      {item && editing ? (
        <FormStack>
          <TextField
            label={copy.itemName}
            value={values.name}
            hint={theirs("name")}
            autoCapitalize="sentences"
            onChangeText={(name) => set({ name })}
          />
          {item.kind === "place" ? (
            <>
              <TextField
                label={copy.itemOtherNames}
                value={values.altNames}
                hint={theirs("altNames") ?? copy.itemOtherNamesHint}
                autoCapitalize="words"
                onChangeText={(altNames) => set({ altNames })}
              />
              <View style={styles.coordRow}>
                <View style={styles.coordField}>
                  <TextField
                    label={copy.itemLatitude}
                    value={values.latitude}
                    hint={theirs("latitude")}
                    keyboardType="numbers-and-punctuation"
                    onChangeText={(latitude) => set({ latitude })}
                  />
                </View>
                <View style={styles.coordField}>
                  <TextField
                    label={copy.itemLongitude}
                    value={values.longitude}
                    hint={theirs("longitude")}
                    keyboardType="numbers-and-punctuation"
                    onChangeText={(longitude) => set({ longitude })}
                  />
                </View>
              </View>
              <TextField
                label={copy.itemElevation}
                value={values.elevation}
                hint={theirs("elevation")}
                keyboardType="numbers-and-punctuation"
                onChangeText={(elevation) => set({ elevation })}
              />
              <TextField
                label={copy.itemNotes}
                value={values.notes}
                hint={theirs("notes")}
                multiline
                autoCapitalize="sentences"
                onChangeText={(notes) => set({ notes })}
              />
              {attrDefs.length > 0 ? (
                <>
                  <SectionHeader title={copy.itemAttributes} />
                  <CustomFieldValueInputs
                    defs={attrDefs}
                    values={Object.fromEntries(
                      attrDefs.map((def) => [
                        def.key,
                        values[ITEM_ATTR + def.key] ?? "",
                      ]),
                    )}
                    onChange={(key, next) => set({ [ITEM_ATTR + key]: next })}
                    // The system attributes of a plan place are numbers and
                    // yes/no: none is a date.
                    onPickDate={() => {}}
                  />
                </>
              ) : null}
            </>
          ) : null}
        </FormStack>
      ) : null}
    </BottomSheet>
  );
}

const useStyles = makeStyles((theme, textRole) => ({
  verbs: { gap: spacing(1) },
  coordRow: { flexDirection: "row", gap: spacing(1) },
  coordField: { flex: 1 },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: theme.line },
  note: { ...muted(theme, textRole.detail) },
}));
