// A place made in the plan: where it is (picked on the map before this opens),
// its type, and the same details a plan place's edit form asks. It belongs to
// the plan, not to the maker's account; Save a copy brings it in. Online only.
// Logjam Web's twin is frontend/src/components/plans/PlanNewPlaceDialog.tsx.
import { useState } from "react";
import { Text } from "react-native";
import {
  abandonConfirm,
  ITEM_ATTR,
  itemFieldDefs,
  messageFromError,
  newPlaceWords,
  PLACE_FORM,
  sameValue,
  SYSTEM_PLACE_TYPE_IDS,
  SYSTEM_PLACE_TYPES,
  TRIP_PLAN_PAGE,
  type ItemWords,
} from "@logjam/shared";

import { unavailableReasonText } from "../auth/capabilities";
import { placeTypeGlyph } from "../places/placeTypeIcon";
import { makeStyles, muted } from "../theme";
import {
  BottomSheet,
  Button,
  ChipRail,
  ErrorBanner,
  Field,
  FormStack,
  TextField,
} from "../ui";
import { PlanDateEditor, PlanPlaceFields } from "./PlanPlaceFields";
import {
  addNewPlaceToPlan,
  placeFormProblem,
  retypePlaceWords,
} from "./planPlaceForm";

const copy = TRIP_PLAN_PAGE.copy;
const OFFLINE = unavailableReasonText("needs-connection");
const TYPE_OPTIONS = SYSTEM_PLACE_TYPES.map((type) => ({
  value: type.id,
  label: type.name,
  icon: placeTypeGlyph(type.iconKey),
  hue: type.color,
}));

type Point = { latitude: number; longitude: number };

export function PlanNewPlaceSheet({
  planId,
  at,
  online,
  onClose,
  onAdded,
}: {
  planId: string;
  /** The point picked on the map; null while the sheet is closed. */
  at: Point | null;
  online: boolean;
  onClose: () => void;
  onAdded: () => void;
}) {
  const styles = useStyles();
  const [typeId, setTypeId] = useState<string>(SYSTEM_PLACE_TYPE_IDS.marker);
  const [values, setValues] = useState<ItemWords>(() => newPlaceWords(typeId));
  const [dateKey, setDateKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A fresh form for each point the sheet opens on.
  const [shownFor, setShownFor] = useState<Point | null>(null);
  if (at !== shownFor) {
    setShownFor(at);
    if (at) {
      const marker = SYSTEM_PLACE_TYPE_IDS.marker;
      setTypeId(marker);
      setValues(newPlaceWords(marker, at));
      setDateKey(null);
      setError(null);
    }
  }
  const defs = itemFieldDefs({ placeTypeId: typeId });
  const dirty = at != null && !sameValue(values, newPlaceWords(typeId, at));

  const set = (next: Record<string, string>) => {
    setValues((was) => ({ ...was, ...next }));
    setError(null);
  };

  async function submit() {
    const problem =
      values.name.trim() === ""
        ? PLACE_FORM.copy.nameMissing
        : placeFormProblem(values, defs);
    if (problem) return setError(problem);
    setBusy(true);
    try {
      await addNewPlaceToPlan(planId, typeId, values);
      onAdded();
    } catch (err) {
      console.error(err);
      setError(messageFromError(err, copy.addCopyFailed));
    } finally {
      setBusy(false);
    }
  }

  const back = dateKey ? () => setDateKey(null) : undefined;
  const dateDef = defs.find((def) => def.key === dateKey);
  return (
    <BottomSheet
      visible={at !== null}
      discard={dirty && !dateKey ? abandonConfirm("place", true) : null}
      onClose={back ?? onClose}
      onBack={back}
      closable={!busy}
      title={dateKey ? (dateDef?.label ?? "Date") : copy.itemNewPlace}
      footer={
        dateKey ? undefined : (
          <FormStack>
            {error ? <ErrorBanner message={error} /> : null}
            <Button
              label={copy.sectionSave}
              icon="done"
              loading={busy}
              disabled={!online}
              disabledReason={OFFLINE}
              reasonShown
              onPress={() => void submit()}
            />
            {/* The button only dims: the words go under it (ui/Button.tsx). */}
            {online ? null : <Text style={styles.note}>{OFFLINE}</Text>}
          </FormStack>
        )
      }
    >
      {dateKey ? (
        <PlanDateEditor
          value={values[ITEM_ATTR + dateKey] ?? ""}
          onChange={(day) => set({ [ITEM_ATTR + dateKey]: day })}
          onClear={() => {
            set({ [ITEM_ATTR + dateKey]: "" });
            setDateKey(null);
          }}
        />
      ) : (
        <FormStack>
          <Text style={styles.note}>{copy.addCopyLine}</Text>
          <Field label={copy.itemType}>
            <ChipRail
              options={TYPE_OPTIONS}
              value={typeId}
              onChange={(next) => {
                setTypeId(next);
                setValues((was) => retypePlaceWords(was, next));
              }}
            />
          </Field>
          <TextField
            label={copy.itemName}
            value={values.name}
            autoCapitalize="sentences"
            onChangeText={(name) => set({ name })}
          />
          <PlanPlaceFields
            values={values}
            defs={defs}
            set={set}
            onPickDate={setDateKey}
          />
        </FormStack>
      )}
    </BottomSheet>
  );
}

const useStyles = makeStyles((theme, textRole) => ({
  note: { ...muted(theme, textRole.detail) },
}));
