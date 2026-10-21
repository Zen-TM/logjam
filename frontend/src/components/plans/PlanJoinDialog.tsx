// Joining a plan, from a link or a leader's username invite:
// the name, the dates and who leads it, then the forms required to join, each
// with who sees its answers. No forms, and it is just the confirm: joining is
// the user's choice, so it still takes the one press. A 409 means a form
// moved since it was shown: the forms are fetched again and what was typed
// is fitted to them as they now are (`fitAnswerDraft`). Drawn from
// `TRIP_PLAN_JOIN`.
import { Fragment, useId, useState, type ReactNode } from "react";
import {
  contractSectionKeys,
  fitAnswerDraft,
  TRIP_PLAN_JOIN,
  tripPlanDatesLabel,
  tripPlanJoinTitle,
  type DateOnly,
  type SectionKeysOn,
  type TripPlanAnswerDraft as AnswerDraft,
  type TripPlanJoinAnswers,
  type TripPlanJoinForm,
} from "@logjam/shared";
import { Button, Dialog, ErrorBanner, SectionHeader } from "../../ui";
import { messageFromError } from "../../errors/messageFromError";
import { ApiError } from "../../errors/ApiError";
import { PlanFormFields } from "./PlanAnswerDialog";
import { joinAnswers } from "./plansModel";
import classes from "./plans.module.css";

const copy = TRIP_PLAN_JOIN.copy;

export default function PlanJoinDialog({
  plan,
  via,
  onJoin,
  onStale,
  onClose,
}: {
  plan: {
    name: string;
    startDate: DateOnly | null;
    endDate: DateOnly | null;
    /** "Leader: mira" for a link; "Invited by mira" for a username invite. */
    person: string | null;
    requiredForms: TripPlanJoinForm[];
  };
  via: "link" | "username";
  onJoin: (answers: TripPlanJoinAnswers) => Promise<void>;
  onStale: () => void;
  onClose: () => void;
}) {
  const formId = useId();
  const [drafts, setDrafts] = useState<Record<string, AnswerDraft>>({});
  // The forms as the drafts were last fitted to them.
  const shownAs = plan.requiredForms.map((form) => form.updatedAt).join();
  const [fittedTo, setFittedTo] = useState({
    shownAs,
    forms: plan.requiredForms,
  });
  if (shownAs !== fittedTo.shownAs) {
    setFittedTo({ shownAs, forms: plan.requiredForms });
    setDrafts(
      Object.fromEntries(
        plan.requiredForms.map((form) => [
          form.id,
          fitAnswerDraft(
            fittedTo.forms.find((was) => was.id === form.id)?.questions ?? [],
            form.questions,
            drafts[form.id] ?? {},
          ),
        ]),
      ),
    );
  }
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const built = joinAnswers(plan.requiredForms, drafts);
    if ("sentence" in built) return setError(built.sentence);
    setBusy(true);
    try {
      await onJoin(built.value);
    } catch (err) {
      console.error(err);
      setError(messageFromError(err, copy.joinFailed));
      if (err instanceof ApiError && err.status === 409) onStale();
    } finally {
      setBusy(false);
    }
  }

  const sections: Record<
    SectionKeysOn<typeof TRIP_PLAN_JOIN, "web">,
    ReactNode
  > = {
    hero: (
      <div className={classes.block}>
        <p className={classes.body}>
          {tripPlanDatesLabel(plan.startDate, plan.endDate)}
        </p>
        {plan.person && (
          <p className={classes.note}>
            {via === "link"
              ? `${copy.leader} ${plan.person}`
              : `${copy.invitedBy} ${plan.person}`}
          </p>
        )}
      </div>
    ),
    forms: plan.requiredForms.length > 0 && (
      <>
        <p className={classes.body}>
          {via === "link" ? copy.answerToAsk : copy.answerToJoin}
        </p>
        {plan.requiredForms.map((form) => (
          <fieldset key={form.id} className={classes.question}>
            <legend className="visually-hidden">{form.title}</legend>
            <SectionHeader title={form.title} />
            <PlanFormFields
              form={form}
              draft={drafts[form.id] ?? {}}
              onChange={(next) => {
                setDrafts((was) => ({ ...was, [form.id]: next }));
                setError(null);
              }}
            />
          </fieldset>
        ))}
      </>
    ),
  };

  return (
    <Dialog
      open
      size={plan.requiredForms.length > 0 ? "large" : "small"}
      title={tripPlanJoinTitle(plan.name)}
      onClose={onClose}
      dismissible={!busy}
      footer={
        <>
          <Button onClick={onClose} disabled={busy} disabledReason="Joining…">
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="filled" busy={busy}>
            {via === "link" ? copy.askToJoin : copy.join}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className={classes.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) void submit();
        }}
      >
        {contractSectionKeys(TRIP_PLAN_JOIN, "web").map((key) => (
          <Fragment key={key}>{sections[key]}</Fragment>
        ))}
        {error && <ErrorBanner message={error} />}
      </form>
    </Dialog>
  );
}
