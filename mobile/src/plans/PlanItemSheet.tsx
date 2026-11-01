// A plan place's, way's or file's ⋯ (`planItemVerbs`, the declaration Logjam
// Web's menu renders from), and the form behind Edit, as modes of one sheet
// (mobile/DESIGN.md §4). Download is left out: a file opens in the viewer
// from its row. Save a copy is the caller's sheet, opened once this one has
// closed. Any refused write fetches the plan again and closes the form with
// the API's sentence: the next Edit starts from the plan as it now is.
import { Fragment, useRef, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import {
  ApiError,
  mediaDisplayName,
  messageFromError,
  planItemDeleteConfirm,
  planItemVerbs,
  TRIP_PLAN_PAGE,
  type PlanItemVerbId,
  type TripPlanItem,
  type TripPlanRole,
} from "@logjam/shared";

import { unavailableReasonText } from "../auth/capabilities";
import { makeStyles, muted, spacing, useTheme } from "../theme";
import {
  BottomSheet,
  Button,
  ErrorBanner,
  FormStack,
  Row,
  TextField,
} from "../ui";
import { itemPatch, itemWords, type ItemWords } from "./planItemEdit";
import { deletePlanItem, patchPlanItem } from "./plansApi";
import { afterPlanWrite } from "./plansCache";

const copy = TRIP_PLAN_PAGE.copy;
const OFFLINE = unavailableReasonText("needs-connection");

export const itemTitle = (item: TripPlanItem) =>
  item.kind === "media" ? mediaDisplayName(item.item) : item.name;

export function PlanItemSheet({
  item,
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
  const key = item ? `${item.kind}:${item.id}` : null;
  if (key !== shownFor) {
    setShownFor(key);
    setEditing(false);
    setError(null);
    if (item) setValues(itemWords(item));
  }
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
    const patch = itemPatch(target, values);
    if (!patch) return onClose();
    setBusy(true);
    try {
      await patchPlanItem(planId, target.kind, target.id, patch);
      await afterPlanWrite(planId);
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        // Changed, gone, or no longer theirs: say so over the plan as it is.
        await afterPlanWrite(planId);
        onClose();
        onError(messageFromError(err, copy.itemSaveFailed));
      } else setError(messageFromError(err, copy.itemSaveFailed));
    } finally {
      setBusy(false);
    }
  }

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
            autoCapitalize="sentences"
            onChangeText={(name) => {
              setValues((was) => ({ ...was, name }));
              setError(null);
            }}
          />
          {item.kind === "place" ? (
            <TextField
              label={copy.itemNotes}
              value={values.notes}
              multiline
              autoCapitalize="sentences"
              onChangeText={(notes) => {
                setValues((was) => ({ ...was, notes }));
                setError(null);
              }}
            />
          ) : null}
        </FormStack>
      ) : null}
    </BottomSheet>
  );
}

const useStyles = makeStyles((theme, textRole) => ({
  verbs: { gap: spacing(1) },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: theme.line },
  note: { ...muted(theme, textRole.detail) },
}));
