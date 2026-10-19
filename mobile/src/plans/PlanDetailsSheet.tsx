// A plan's name, dates and trip types: New plan and Edit name and dates are
// one form (shared/DESIGN.md §10). An edit sends only what changed, each as
// the value last seen and the new one, so a save over someone else's change
// is refused, not lost; when the plan is fetched again under the open sheet,
// every field the user has not touched follows it (`tripPlanAdoptTheirs`).
// The dates are a mode of this sheet, never a second sheet.
import { useMemo, useState } from "react";
import {
  formatDateKey,
  messageFromError,
  parseTripPlanCreate,
  tripPlanAdoptTheirs,
  tripPlanPatch,
  TRIP_PLAN_NAME_MAX_LENGTH,
  TRIP_PLANS_LIST,
  TRIP_TYPE_SUGGESTIONS,
  type TripPlanPatch,
  type TripPlanValues,
  type TripPlanView,
} from "@logjam/shared";

import { tripTypeLabel, tripTypeMeta } from "../logs/tripTypeMeta";
import { useTheme } from "../theme";
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
type Mode = "form" | "startDate" | "endDate";

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
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={plan ? copy.editTitle : copy.newTitle}
    >
      {/* Mounted on open, so a reopened form starts from the plan as it is. */}
      {visible ? (
        <DetailsForm plan={plan} onSubmit={onSubmit} onClose={onClose} />
      ) : null}
    </BottomSheet>
  );
}

function DetailsForm({
  plan,
  onSubmit,
  onClose,
}: {
  plan?: TripPlanView;
  onSubmit: (values: TripPlanValues, patch: TripPlanPatch) => Promise<void>;
  onClose: () => void;
}) {
  const theme = useTheme();
  const current: TripPlanValues = useMemo(
    () => ({
      name: plan?.name ?? "",
      startDate: plan?.startDate ?? null,
      endDate: plan?.endDate ?? null,
      tripTypes: plan?.tripTypes ?? [],
    }),
    [plan],
  );
  const [seen, setSeen] = useState(current);
  const [values, setValues] = useState(current);
  const [mode, setMode] = useState<Mode>("form");
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (JSON.stringify(current) !== JSON.stringify(seen)) {
    const next = tripPlanAdoptTheirs(seen, values, current);
    setSeen(next.seen);
    setValues(next.values);
  }
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

  if (mode !== "form") {
    const key = mode;
    return (
      <FormStack>
        <DatePicker
          value={values[key]}
          onChange={(day) => set({ [key]: day })}
        />
        {values[key] ? (
          <Button
            label="Clear date"
            icon="close"
            variant="ghost"
            onPress={() => {
              set({ [key]: null });
              setMode("form");
            }}
          />
        ) : null}
        <Button label="Done" icon="done" onPress={() => setMode("form")} />
      </FormStack>
    );
  }

  const day = (key: "startDate" | "endDate", label: string) => (
    <Row
      icon="date"
      title={
        values[key] ? formatDateKey(`${values[key]}T00:00:00.000Z`) : "None"
      }
      subtitle={label}
      right={<Icon idea="disclosure" size={20} color={theme.textMuted} />}
      onPress={() => setMode(key)}
    />
  );

  return (
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
      {day("startDate", copy.startDate)}
      {day("endDate", copy.endDate)}
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
      {error ? <ErrorBanner message={error} /> : null}
      <Button
        label={plan ? copy.save : copy.make}
        icon="done"
        loading={busy}
        onPress={() => void submit()}
      />
    </FormStack>
  );
}
