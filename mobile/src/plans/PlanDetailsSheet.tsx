// A plan's name, dates and trip types: New plan and Edit name and dates are
// one form (shared/DESIGN.md §10). An edit sends only what changed, each as
// the value last seen and the new one, so a save over someone else's change
// is refused, not lost; when the plan is fetched again under the open sheet,
// every field the user has not touched follows it (`tripPlanAdoptTheirs`),
// and an edited field the plan changed shows the plan's value under it. The
// dates are a sub-mode of this sheet (mobile/DESIGN.md §4).
import { useMemo, useState } from "react";
import { Text } from "react-native";
import {
  messageFromError,
  parseTripPlanCreate,
  tripPlanAdoptTheirs,
  tripPlanDatesLabel,
  tripPlanInPlanNow,
  tripPlanPatch,
  tripPlanSame,
  tripPlanTheirsChanged,
  TRIP_PLAN_FIELD_GROUPS,
  TRIP_PLAN_NAME_MAX_LENGTH,
  TRIP_PLANS_LIST,
  TRIP_TYPE_SUGGESTIONS,
  type TripPlanPatch,
  type TripPlanValues,
  type TripPlanView,
} from "@logjam/shared";

import { tapRange } from "../ui/monthGrid";
import { tripTypeLabel, tripTypeMeta } from "../logs/tripTypeMeta";
import { makeStyles, muted, useTheme } from "../theme";
import {
  BottomSheet,
  Button,
  ChipPicker,
  DatePicker,
  ErrorBanner,
  FormStack,
  Icon,
  Row,
  TextField,
  type ChipOption,
} from "../ui";

const copy = TRIP_PLANS_LIST.copy;
type Mode = "form" | "dates";

const valuesOf = (plan?: TripPlanView): TripPlanValues => ({
  name: plan?.name ?? "",
  startDate: plan?.startDate ?? null,
  endDate: plan?.endDate ?? null,
  tripTypes: plan?.tripTypes ?? [],
});

export function PlanDetailsSheet({
  visible,
  plan,
  onSubmit,
  onClose,
}: {
  visible: boolean;
  /** Absent: New plan. Updated in place after a refetch. */
  plan?: TripPlanView;
  onSubmit: (values: TripPlanValues, patch: TripPlanPatch) => Promise<void>;
  onClose: () => void;
}) {
  const theme = useTheme();
  const styles = useStyles();
  const current = useMemo(() => valuesOf(plan), [plan]);
  // Each opening starts from the plan as it is.
  const [wasVisible, setWasVisible] = useState(false);
  const [opened, setOpened] = useState(current);
  const [seen, setSeen] = useState(current);
  const [values, setValues] = useState(current);
  const [mode, setMode] = useState<Mode>("form");
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setOpened(current);
      setSeen(current);
      setValues(current);
      setMode("form");
      setError(null);
      setNameError(null);
    }
  } else if (!tripPlanSame(current, seen)) {
    const next = tripPlanAdoptTheirs(
      seen,
      values,
      current,
      TRIP_PLAN_FIELD_GROUPS,
    );
    setSeen(next.seen);
    setValues(next.values);
  }
  /** The plan's value, under a field the user edited and the plan changed
   *  since the form opened. */
  const theirs = (fields: (keyof TripPlanValues)[], words: string) =>
    tripPlanTheirsChanged(fields, values, current, opened) ? (
      <Text style={styles.theirs}>{tripPlanInPlanNow(words)}</Text>
    ) : null;

  const set = (next: Partial<TripPlanValues>) => {
    setValues((was) => ({ ...was, ...next }));
    setError(null);
  };

  const typeOptions: ChipOption[] = useMemo(
    () =>
      [...new Set([...TRIP_TYPE_SUGGESTIONS, ...values.tripTypes])].map(
        (type) => ({
          value: type,
          label: tripTypeLabel(type),
          hue: tripTypeMeta(type, theme).hue,
          icon: tripTypeMeta(type, theme).icon,
        }),
      ),
    [theme, values.tripTypes],
  );
  const toggleType = (type: string) =>
    set({
      tripTypes: values.tripTypes.includes(type)
        ? values.tripTypes.filter((each) => each !== type)
        : [...values.tripTypes, type],
    });

  async function submit() {
    // The API's own rule first, so the refusal is the one it sends.
    const failed = plan ? copy.saveFailed : copy.makeFailed;
    const name = parseTripPlanCreate({ name: values.name });
    if (!("value" in name))
      return setNameError("sentence" in name ? name.sentence : failed);
    const parsed = parseTripPlanCreate(values);
    if (!("value" in parsed))
      return setError("sentence" in parsed ? parsed.sentence : failed);
    const patch = tripPlanPatch(seen, parsed.value);
    if (plan && Object.keys(patch).length === 0) return onClose();
    setBusy(true);
    try {
      await onSubmit(parsed.value, patch);
    } catch (err) {
      setError(messageFromError(err, failed));
    } finally {
      setBusy(false);
    }
  }

  const toForm = () => setMode("form");
  const datesRow = (
    <Row
      icon="date"
      title={tripPlanDatesLabel(values.startDate, values.endDate)}
      subtitle="Dates"
      right={<Icon idea="disclosure" size={20} color={theme.textMuted} />}
      onPress={() => setMode("dates")}
    />
  );

  return (
    <BottomSheet
      visible={visible}
      // Inside the date sub-mode, a drag or × is back to the form, not away
      // with everything typed.
      onClose={mode === "form" ? onClose : toForm}
      onBack={mode === "form" ? undefined : toForm}
      title={
        mode === "form" ? (plan ? copy.editTitle : copy.newTitle) : "Dates"
      }
      // Pinned: with the keyboard up the form outgrows the sheet.
      footer={
        mode === "form" ? (
          <FormStack>
            {error ? <ErrorBanner message={error} /> : null}
            <Button
              label={plan ? copy.save : copy.make}
              icon="done"
              loading={busy}
              onPress={() => void submit()}
            />
          </FormStack>
        ) : (
          <Button label="Done" icon="done" onPress={toForm} />
        )
      }
    >
      {!visible ? null : mode !== "form" ? (
        <FormStack>
          <DatePicker
            value={values.startDate}
            allowFuture
            range={{ start: values.startDate, end: values.endDate }}
            onChange={(tapped) => {
              const next = tapRange(
                { start: values.startDate, end: values.endDate },
                tapped,
              );
              set({ startDate: next.start, endDate: next.end });
            }}
          />
          {values.startDate ? (
            <Button
              label="Clear dates"
              icon="close"
              variant="ghost"
              onPress={() => {
                set({ startDate: null, endDate: null });
                toForm();
              }}
            />
          ) : null}
        </FormStack>
      ) : (
        <FormStack>
          <TextField
            label={copy.name}
            value={values.name}
            maxLength={TRIP_PLAN_NAME_MAX_LENGTH}
            autoCapitalize="sentences"
            error={nameError}
            onChangeText={(name) => {
              set({ name });
              setNameError(null);
            }}
          />
          {theirs(["name"], current.name)}
          {datesRow}
          {theirs(
            ["startDate", "endDate"],
            tripPlanDatesLabel(current.startDate, current.endDate),
          )}
          <ChipPicker
            label={copy.tripTypes}
            options={typeOptions}
            selected={values.tripTypes}
            onToggle={toggleType}
            onAdd={(label) =>
              values.tripTypes.includes(label) ? undefined : toggleType(label)
            }
            addPlaceholder={copy.addTripType}
          />
          {theirs(
            ["tripTypes"],
            current.tripTypes.map(tripTypeLabel).join(", "),
          )}
        </FormStack>
      )}
    </BottomSheet>
  );
}

const useStyles = makeStyles((theme, textRole) => ({
  theirs: { ...muted(theme, textRole.detail) },
}));
