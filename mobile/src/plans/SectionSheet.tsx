// A write-up section's sheet: its ⋯ (`PLAN_SECTION_VERBS`), and the form
// that adds or edits it, as two modes of one sheet (never a second sheet). An
// edit sends each changed field as the value last seen and the new one; on a
// 409 the form stays open with the API's sentence and keeps what was typed,
// the plan is fetched again, and every field the user has not touched
// follows it (`tripPlanAdoptTheirs`), so the next Save compares against that.
import { Fragment, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import {
  ApiError,
  messageFromError,
  parseTripPlanSectionCreate,
  planAddVerbLabel,
  planSectionDeleteConfirm,
  planVerbsFor,
  tripPlanAdoptTheirs,
  tripPlanSectionPatch,
  PLAN_SECTION_VERBS,
  TRIP_PLAN_PAGE,
  TRIP_PLAN_SECTION_BODY_MAX_LENGTH,
  TRIP_PLAN_SECTION_SUGGESTIONS,
  TRIP_PLAN_SECTION_TITLE_MAX_LENGTH,
  type PlanSectionVerbId,
  type TripPlanRole,
  type TripPlanSectionView,
} from "@logjam/shared";

import { unavailableReasonText } from "../auth/capabilities";
import { makeStyles, spacing, useTheme } from "../theme";
import {
  BottomSheet,
  Button,
  ChipRail,
  ErrorBanner,
  FormStack,
  Row,
  TextField,
} from "../ui";
import {
  createSection,
  deleteSection,
  patchSection,
  reorderSections,
} from "./plansApi";
import { afterPlanWrite } from "./plansCache";

const copy = TRIP_PLAN_PAGE.copy;
const OFFLINE = unavailableReasonText("needs-connection");

/** Which sheet is open: a section's ⋯, its form, or a new section's form. */
export type SectionSheetState =
  | { mode: "verbs"; sectionId: string }
  | { mode: "edit"; sectionId: string }
  | { mode: "add" }
  | null;

export function SectionSheet({
  state,
  planId,
  role,
  sections,
  online,
  onState,
  onInfo,
  onError,
}: {
  state: SectionSheetState;
  planId: string;
  role: TripPlanRole;
  /** The plan's sections as cached, in order. */
  sections: readonly TripPlanSectionView[];
  online: boolean;
  onState: (next: SectionSheetState) => void;
  onInfo: (message: string) => void;
  onError: (message: string) => void;
}) {
  const theme = useTheme();
  const styles = useStyles();
  const close = () => onState(null);
  const section =
    state && state.mode !== "add"
      ? sections.find((each) => each.id === state.sectionId)
      : undefined;
  // A section deleted under an open sheet: nothing left to act on.
  const open = state !== null && (state.mode === "add" || section != null);

  const move = (id: string, by: -1 | 1) => {
    const ids = sections.map((each) => each.id);
    const from = ids.indexOf(id);
    const to = from + by;
    if (to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    reorderSections(planId, ids)
      .then(() => afterPlanWrite(planId))
      .catch((err: unknown) =>
        onError(messageFromError(err, copy.sectionMoveFailed)),
      );
  };

  const confirmDelete = (target: TripPlanSectionView) => {
    const confirm = planSectionDeleteConfirm(target.title);
    Alert.alert(confirm.confirmTitle, confirm.confirmBody, [
      { text: "Cancel", style: "cancel" },
      {
        text: confirm.confirmLabel,
        style: "destructive",
        onPress: () => {
          deleteSection(planId, target.id)
            .then(() => afterPlanWrite(planId))
            .then(() => onInfo(copy.sectionDeleted))
            .catch((err: unknown) =>
              onError(messageFromError(err, copy.sectionDeleteFailed)),
            );
        },
      },
    ]);
  };

  const run = (id: PlanSectionVerbId, target: TripPlanSectionView) => {
    if (id === "edit") return onState({ mode: "edit", sectionId: target.id });
    close();
    if (id === "moveUp") move(target.id, -1);
    else if (id === "moveDown") move(target.id, 1);
    else confirmDelete(target);
  };

  const index = section ? sections.indexOf(section) : -1;
  const verbs = planVerbsFor(PLAN_SECTION_VERBS, "gps", role, {
    archived: false,
  }).filter(
    (verb) =>
      !(verb.id === "moveUp" && index === 0) &&
      !(verb.id === "moveDown" && index === sections.length - 1),
  );

  return (
    <BottomSheet
      visible={open}
      onClose={close}
      title={
        state?.mode === "verbs" && section ? section.title : copy.sectionTitle
      }
      onBack={
        state?.mode === "edit"
          ? () => onState({ mode: "verbs", sectionId: state.sectionId })
          : undefined
      }
    >
      {state?.mode === "verbs" && section ? (
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
                subtitle={online ? undefined : OFFLINE}
                disabled={!online}
                onPress={() => run(verb.id, section)}
              />
            </Fragment>
          ))}
        </View>
      ) : null}
      {state?.mode === "edit" && section ? (
        <SectionForm
          key={section.id}
          planId={planId}
          section={section}
          online={online}
          onDone={close}
        />
      ) : null}
      {state?.mode === "add" ? (
        <SectionForm planId={planId} online={online} onDone={close} />
      ) : null}
    </BottomSheet>
  );
}

type Values = { title: string; body: string };

function SectionForm({
  planId,
  section,
  online,
  onDone,
}: {
  planId: string;
  /** Absent: a new section. Updated in place after a refetch. */
  section?: TripPlanSectionView;
  online: boolean;
  onDone: () => void;
}) {
  const current: Values = {
    title: section?.title ?? "",
    body: section?.body ?? "",
  };
  const [seen, setSeen] = useState(current);
  const [values, setValues] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (current.title !== seen.title || current.body !== seen.body) {
    const next = tripPlanAdoptTheirs(seen, values, current);
    setSeen(next.seen);
    setValues(next.values);
  }
  const set = (next: Partial<Values>) => {
    setValues((was) => ({ ...was, ...next }));
    setError(null);
  };

  async function submit() {
    const parsed = parseTripPlanSectionCreate(values);
    if (!("value" in parsed)) {
      const sentence = "sentence" in parsed ? parsed.sentence : null;
      if (!values.title.trim())
        setTitleError(sentence ?? copy.sectionSaveFailed);
      else setError(sentence ?? copy.sectionSaveFailed);
      return;
    }
    const patch = tripPlanSectionPatch(seen, parsed.value);
    if (section && Object.keys(patch).length === 0) return onDone();
    setBusy(true);
    try {
      if (section) await patchSection(planId, section.id, patch);
      else await createSection(planId, parsed.value);
      await afterPlanWrite(planId);
      onDone();
    } catch (err) {
      setError(messageFromError(err, copy.sectionSaveFailed));
      if (err instanceof ApiError && err.status === 409)
        await afterPlanWrite(planId);
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormStack>
      {section ? null : (
        <ChipRail
          scroll
          options={TRIP_PLAN_SECTION_SUGGESTIONS.map((title) => ({
            value: title,
            label: title,
          }))}
          value={values.title}
          onChange={(title) => {
            set({ title });
            setTitleError(null);
          }}
        />
      )}
      <TextField
        label={copy.sectionTitleField}
        value={values.title}
        maxLength={TRIP_PLAN_SECTION_TITLE_MAX_LENGTH}
        autoCapitalize="sentences"
        error={titleError}
        onChangeText={(title) => {
          set({ title });
          setTitleError(null);
        }}
      />
      <TextField
        label={copy.sectionBody}
        value={values.body}
        multiline
        autoCapitalize="sentences"
        // A limit shows live (shared/DESIGN.md §11).
        hint={
          values.body.length > TRIP_PLAN_SECTION_BODY_MAX_LENGTH * 0.9
            ? `${values.body.length} of ${TRIP_PLAN_SECTION_BODY_MAX_LENGTH} characters`
            : undefined
        }
        onChangeText={(body) => set({ body })}
      />
      {error ? <ErrorBanner message={error} /> : null}
      <Button
        label={section ? copy.sectionSave : planAddVerbLabel("section")}
        icon="done"
        loading={busy}
        disabled={!online}
        disabledReason={OFFLINE}
        onPress={() => void submit()}
      />
    </FormStack>
  );
}

const useStyles = makeStyles((theme) => ({
  verbs: { gap: spacing(1) },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: theme.line },
}));
