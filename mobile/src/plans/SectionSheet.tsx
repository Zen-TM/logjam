// A write-up section's sheet: its ⋯ (`planSectionVerbs`), and the form that
// adds or edits it, as modes of one sheet (mobile/DESIGN.md §4). An edit
// sends each changed field as the value last seen and the new one. Any
// refused write fetches the plan again: on a 409 the form stays open with
// the API's sentence and what was typed, every field the user has not
// touched follows the plan (`tripPlanAdoptTheirs`), and an edited field the
// plan changed shows the plan's value under it; a section deleted elsewhere
// closes the sheet.
import { Fragment, useState, type Dispatch, type SetStateAction } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import {
  ApiError,
  limitHint,
  messageFromError,
  parseTripPlanSectionCreate,
  planAddVerbLabel,
  planSectionDeleteConfirm,
  planSectionsMoved,
  planSectionVerbs,
  tripPlanAdoptTheirs,
  tripPlanInPlanNow,
  tripPlanSame,
  tripPlanSectionPatch,
  tripPlanTheirsChanged,
  TRIP_PLAN_PAGE,
  TRIP_PLAN_SECTION_BODY_MAX_LENGTH,
  TRIP_PLAN_SECTION_SUGGESTIONS,
  TRIP_PLAN_SECTION_TITLE_MAX_LENGTH,
  type PlanSectionVerbId,
  type TripPlanRole,
  type TripPlanSectionView,
} from "@logjam/shared";

import { unavailableReasonText } from "../auth/capabilities";
import { makeStyles, muted, spacing, useTheme } from "../theme";
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

type Values = { title: string; body: string };

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
  /** null also when the caller can no longer write (archived, demoted). */
  state: SectionSheetState;
  planId: string;
  role: TripPlanRole;
  /** The plan's sections as cached, in order. */
  sections: readonly TripPlanSectionView[];
  online: boolean;
  onState: Dispatch<SetStateAction<SectionSheetState>>;
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
  // A move until its refetch lands: a second one would start from the old
  // order and undo the first.
  const [moving, setMoving] = useState(false);

  // The form's state lives here, so its Save can sit in the sheet's footer.
  const formKey =
    state?.mode === "edit" && section
      ? `edit:${section.id}`
      : state?.mode === "add"
        ? "add"
        : null;
  const current: Values = {
    title: formKey === "add" ? "" : (section?.title ?? ""),
    body: formKey === "add" ? "" : (section?.body ?? ""),
  };
  const [formFor, setFormFor] = useState<string | null>(null);
  const [opened, setOpened] = useState(current);
  const [seen, setSeen] = useState(current);
  const [values, setValues] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [bodyError, setBodyError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (formKey !== formFor) {
    setFormFor(formKey);
    setOpened(current);
    setSeen(current);
    setValues(current);
    setError(null);
    setTitleError(null);
    setBodyError(null);
  } else if (formKey && !tripPlanSame(current, seen)) {
    const next = tripPlanAdoptTheirs(seen, values, current);
    setSeen(next.seen);
    setValues(next.values);
  }
  /** The plan's value, under a field the user edited and the plan changed
   *  since the form opened. */
  const theirs = (field: keyof Values) =>
    formKey !== "add" && tripPlanTheirsChanged([field], values, current, opened)
      ? tripPlanInPlanNow(current[field])
      : undefined;
  const set = (next: Partial<Values>) => {
    setValues((was) => ({ ...was, ...next }));
    setError(null);
  };

  const refused = (err: unknown, failed: string) => {
    if (err instanceof ApiError) void afterPlanWrite(planId);
    onError(messageFromError(err, failed));
  };

  const move = (index: number, by: -1 | 1) => {
    const ids = planSectionsMoved(
      sections.map((each) => each.id),
      index,
      by,
    );
    if (!ids) return;
    setMoving(true);
    reorderSections(planId, ids)
      .then(() => afterPlanWrite(planId))
      .catch((err: unknown) => refused(err, copy.sectionMoveFailed))
      .finally(() => setMoving(false));
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
            .catch((err: unknown) => refused(err, copy.sectionDeleteFailed));
        },
      },
    ]);
  };

  const index = section ? sections.indexOf(section) : -1;
  const run = (id: PlanSectionVerbId, target: TripPlanSectionView) => {
    if (id === "edit") return onState({ mode: "edit", sectionId: target.id });
    close();
    if (id === "moveUp") move(index, -1);
    else if (id === "moveDown") move(index, 1);
    else confirmDelete(target);
  };
  const verbs = planSectionVerbs("gps", role, {
    archived: false,
    index,
    count: sections.length,
  });

  async function submit() {
    const parsed = parseTripPlanSectionCreate(values);
    if (!("value" in parsed)) {
      const sentence = "sentence" in parsed ? parsed.sentence : null;
      // The title's refusals are caught by its own rules first; what is left
      // is the body's length.
      if (!values.title.trim())
        setTitleError(sentence ?? copy.sectionSaveFailed);
      else setBodyError(sentence ?? copy.sectionSaveFailed);
      return;
    }
    const patch = tripPlanSectionPatch(seen, parsed.value);
    if (section && Object.keys(patch).length === 0) return close();
    // A save that lands after the sheet was swiped away and another
    // section's ⋯ opened leaves that one open.
    const saving = state;
    setBusy(true);
    try {
      if (formKey !== "add" && section)
        await patchSection(planId, section.id, patch);
      else await createSection(planId, parsed.value);
      await afterPlanWrite(planId);
      onState((now) => (now === saving ? null : now));
    } catch (err) {
      setError(messageFromError(err, copy.sectionSaveFailed));
      if (err instanceof ApiError) await afterPlanWrite(planId);
    } finally {
      setBusy(false);
    }
  }

  // Inside edit, every way out is back to the section's ⋯, not away with
  // what was typed.
  const back =
    state?.mode === "edit"
      ? () => onState({ mode: "verbs", sectionId: state.sectionId })
      : undefined;
  const editing = formKey !== null;

  return (
    <BottomSheet
      visible={open}
      onClose={back ?? close}
      onBack={back}
      title={
        state?.mode === "verbs" && section ? section.title : copy.sectionTitle
      }
      // Pinned: a long body outgrows the sheet.
      footer={
        editing ? (
          <FormStack>
            {error ? <ErrorBanner message={error} /> : null}
            <Button
              label={
                formKey === "add"
                  ? planAddVerbLabel("section")
                  : copy.sectionSave
              }
              icon="done"
              loading={busy}
              disabled={!online}
              disabledReason={OFFLINE}
              onPress={() => void submit()}
            />
            {/* The button only dims: the words go under it (ui/Button.tsx). */}
            {online ? null : <Text style={styles.note}>{OFFLINE}</Text>}
          </FormStack>
        ) : undefined
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
                disabled={
                  !online ||
                  (moving && (verb.id === "moveUp" || verb.id === "moveDown"))
                }
                onPress={() => run(verb.id, section)}
              />
            </Fragment>
          ))}
        </View>
      ) : null}
      {editing ? (
        <FormStack>
          {formKey === "add" ? (
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
          ) : null}
          <TextField
            label={copy.sectionTitleField}
            value={values.title}
            maxLength={TRIP_PLAN_SECTION_TITLE_MAX_LENGTH}
            autoCapitalize="sentences"
            error={titleError}
            hint={theirs("title")}
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
            error={bodyError}
            hint={limitHint(
              values.body.length,
              TRIP_PLAN_SECTION_BODY_MAX_LENGTH,
            )}
            onChangeText={(body) => {
              set({ body });
              setBodyError(null);
            }}
          />
          {theirs("body") ? (
            <Text style={styles.note}>{theirs("body")}</Text>
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
