// The New form dialog's first step: a blank form, a template, or a copy of a
// form from another plan the caller leads (`GET /plans/leader-forms`).
import { useEffect, useState } from "react";
import {
  TRIP_PLAN_FORM_PRESET_BLURBS,
  TRIP_PLAN_FORM_PRESET_IDS,
  TRIP_PLAN_FORM_PRESETS,
  TRIP_PLAN_FORMS,
  pluralCount,
  tripPlanBlankForm,
  type TripPlanFormValues,
  type TripPlanLeaderForm,
} from "@logjam/shared";
import {
  ErrorState,
  IconTile,
  LoadingState,
  Row,
  SectionHeader,
} from "../../ui";
import { getLeaderForms } from "../../plansApi";
import { messageFromError } from "../../errors/messageFromError";
import classes from "./plans.module.css";

const copy = TRIP_PLAN_FORMS.copy;

export default function PlanFormChooser({
  planId,
  onPick,
}: {
  /** The plan the form is for: its own forms are not offered back. */
  planId: string;
  onPick: (values: TripPlanFormValues) => void;
}) {
  // Tagged with the request it answers, so a retry reads as loading again
  // without resetting state inside the effect.
  const [attempt, setAttempt] = useState(0);
  const key = `${planId}:${attempt}`;
  const [fetched, setFetched] = useState<{
    key: string;
    forms?: TripPlanLeaderForm[];
    error?: string;
  } | null>(null);
  const answer = fetched?.key === key ? fetched : null;
  const mine = answer?.forms ?? null;
  const error = answer?.error ?? null;

  useEffect(() => {
    let live = true;
    getLeaderForms(planId)
      .then((forms) => live && setFetched({ key, forms }))
      .catch((err) => {
        console.error(err);
        if (live)
          setFetched({
            key,
            error: messageFromError(err, copy.chooseMineFailed),
          });
      });
    return () => {
      live = false;
    };
  }, [planId, key]);

  return (
    <div className={classes.form}>
      <SectionHeader title={copy.startFrom} />
      <Row
        title={copy.blank}
        subtitle={copy.chooseBlankHint}
        leading={<IconTile icon="add" hue="var(--hue-plan)" />}
        onOpen={() => onPick(tripPlanBlankForm())}
      />
      {/* What the leader already built goes first; the rest wait their turn. */}
      {mine != null && mine.length > 0 && (
        <>
          <SectionHeader title={copy.chooseMine} />
          {mine.map((each) => (
            <Row
              key={each.formId}
              title={each.title}
              subtitle={`${copy.chooseFrom} ${each.planName} · ${pluralCount(
                each.questions.length,
                "question",
              )}`}
              leading={<IconTile icon="copy" hue="var(--hue-plan)" />}
              onOpen={() =>
                onPick({
                  title: each.title,
                  preset: each.preset,
                  visibleTo: each.visibleTo,
                  questions: structuredClone(each.questions),
                })
              }
            />
          ))}
        </>
      )}
      <SectionHeader title={copy.chooseTemplates} />
      {TRIP_PLAN_FORM_PRESET_IDS.map((id) => (
        <Row
          key={id}
          title={TRIP_PLAN_FORM_PRESETS[id].title}
          subtitle={`${TRIP_PLAN_FORM_PRESET_BLURBS[id]} ${pluralCount(
            TRIP_PLAN_FORM_PRESETS[id].questions.length,
            "question",
          )}.`}
          leading={<IconTile icon="form" hue="var(--hue-plan)" />}
          onOpen={() => onPick({ ...TRIP_PLAN_FORM_PRESETS[id], preset: id })}
        />
      ))}
      {error ? (
        <ErrorState message={error} onRetry={() => setAttempt((n) => n + 1)} />
      ) : mine == null ? (
        <LoadingState label={copy.chooseMineLoading} />
      ) : mine.length === 0 ? (
        <p className={classes.note}>{copy.chooseMineEmpty}</p>
      ) : null}
    </div>
  );
}
