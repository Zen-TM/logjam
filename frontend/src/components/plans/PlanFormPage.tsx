// A form's page, one step inside the plan's Forms view: who sees the answers,
// the caller's own answer (or Answer), then everyone's, when the caller may
// see them, as a table a row per member, and a leader's table of those asking
// to join. Drawn from `TRIP_PLAN_FORMS`.
import { Fragment, type ReactNode } from "react";
import {
  contractSectionKeys,
  currentTripPlanAnswers,
  planVerbsFor,
  PLAN_FORM_VERBS,
  TRIP_PLAN_FORMS,
  tripPlanAnswerText,
  tripPlanSeesAnswers,
  tripPlanVisibilityLine,
  type PlanFormVerbId,
  type SectionKeysOn,
  type TripPlanAnswerView,
  type TripPlanFormView,
  type TripPlanMemberView,
  type TripPlanRole,
  type TripPlanUserRef,
} from "@logjam/shared";
import { Button, Hero, IconButton, Menu, SectionHeader } from "../../ui";
import { menuEntries } from "./planMenu";
import classes from "./plans.module.css";

const copy = TRIP_PLAN_FORMS.copy;

export default function PlanFormPage({
  form,
  role,
  archived,
  members,
  onBack,
  onAnswer,
  onVerb,
}: {
  form: TripPlanFormView;
  role: TripPlanRole;
  archived: boolean;
  /** Everyone in the plan the caller can see, for the table's rows. */
  members: TripPlanMemberView[];
  onBack: () => void;
  onAnswer: () => void;
  onVerb: (id: PlanFormVerbId) => void;
}) {
  const verbs = planVerbsFor(PLAN_FORM_VERBS, "web", role, { archived });
  const mine = form.myAnswer
    ? currentTripPlanAnswers(form.questions, form.myAnswer.answers)
    : null;
  // Who's going, each with their answer or none, those without last. Under
  // them, for a leader (the API serves no one else theirs), those asking to
  // join who answered: what a leader reads before letting them in.
  const answerBy = new Map(
    [...form.answers, ...(form.myAnswer ? [form.myAnswer] : [])].map(
      (answer) => [answer.user.id, answer],
    ),
  );
  const rows = members
    .filter((member) => member.status === "active")
    .map((member) => ({
      user: member.user,
      answer: answerBy.get(member.user.id),
    }))
    .sort((a, b) => Number(!a.answer) - Number(!b.answer));
  const asking = members
    .filter((member) => member.status === "requested")
    .flatMap((member) => {
      const answer = answerBy.get(member.user.id);
      return answer ? [{ user: member.user, answer }] : [];
    });

  const table = (
    title: string,
    people: { user: TripPlanUserRef; answer?: TripPlanAnswerView }[],
  ) => (
    <div className={classes.block}>
      <SectionHeader title={title} />
      {/* Scrolled sideways on its own, so a keyboard can reach it. */}
      <div
        className={classes.tableScroll}
        role="region"
        aria-label={title}
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scroll region is the case the rule's own docs exempt
        tabIndex={0}
      >
        <table className={classes.table}>
          <thead>
            <tr>
              <th scope="col">{copy.member}</th>
              {form.questions.map((question) => (
                <th key={question.id} scope="col">
                  {question.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {people.map(({ user, answer }) => {
              const values = answer
                ? currentTripPlanAnswers(form.questions, answer.answers)
                : null;
              return (
                <tr key={user.id}>
                  <th scope="row">{user.username}</th>
                  {values ? (
                    form.questions.map((question) => (
                      <td key={question.id}>
                        {tripPlanAnswerText(question, values[question.id])}
                      </td>
                    ))
                  ) : (
                    <td
                      colSpan={form.questions.length}
                      className={classes.note}
                    >
                      {copy.noAnswerYet}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

  const sections: Record<
    SectionKeysOn<typeof TRIP_PLAN_FORMS, "web">,
    ReactNode
  > = {
    hero: (
      <Hero
        title={form.title}
        onBack={onBack}
        backLabel={copy.back}
        actions={
          verbs.length > 0 && (
            <Menu
              label={copy.actions}
              title={form.title}
              placement="bottom-end"
              entries={menuEntries(verbs, onVerb)}
              trigger={(props) => (
                <IconButton {...props} icon="overflow" label={copy.actions} />
              )}
            />
          )
        }
      />
    ),
    visibility: (
      <p className={classes.note}>{tripPlanVisibilityLine(form.visibleTo)}</p>
    ),
    mine: (
      <div className={classes.block}>
        <SectionHeader title={copy.mine} />
        {mine ? (
          <dl className={classes.answers}>
            {form.questions.map((question) => (
              <Fragment key={question.id}>
                <dt className={classes.note}>{question.label}</dt>
                <dd className={classes.body}>
                  {tripPlanAnswerText(question, mine[question.id]) || "—"}
                </dd>
              </Fragment>
            ))}
          </dl>
        ) : (
          <p className={classes.note}>{copy.noAnswer}</p>
        )}
        {!archived && (
          <div>
            <Button
              compact
              variant={mine ? "outline" : "filled"}
              icon="edit"
              onClick={onAnswer}
            >
              {mine ? copy.change : copy.answer}
            </Button>
          </div>
        )}
      </div>
    ),
    table: tripPlanSeesAnswers(role, form.visibleTo) && (
      <>
        {table(copy.answers, rows)}
        {asking.length > 0 && table(copy.asking, asking)}
      </>
    ),
  };

  return (
    <div className={classes.root}>
      {sections.hero}
      <div className={classes.list}>
        {contractSectionKeys(TRIP_PLAN_FORMS, "web")
          .filter((key) => key !== "hero")
          .map((key) => (
            <Fragment key={key}>{sections[key]}</Fragment>
          ))}
      </div>
    </div>
  );
}
