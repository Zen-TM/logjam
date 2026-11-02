// A form's page, one step inside the plan's Forms view: who sees the answers,
// the caller's own answer (or Answer), then everyone's, when the caller may
// see them, as a table a row per member, and a leader's table of those asking
// to join. Drawn from `TRIP_PLAN_FORMS`.
import { Fragment, type ReactNode } from "react";
import {
  tripPlanAnswerTable,
  contractSectionKeys,
  currentTripPlanAnswers,
  planVerbsFor,
  PLAN_FORM_VERBS,
  TRIP_PLAN_FORMS,
  TRIP_PLAN_PAGE,
  tripPlanAnswerText,
  tripPlanSeesAnswers,
  tripPlanVisibilityLine,
  type PlanFormVerbId,
  type SectionKeysOn,
  type TripPlanFormView,
  type TripPlanMemberView,
  type TripPlanRole,
} from "@logjam/shared";
import {
  Button,
  DataTable,
  Hero,
  IconButton,
  Menu,
  SectionHeader,
} from "../../ui";
import { menuEntries } from "./planMenu";
import classes from "./plans.module.css";

const copy = TRIP_PLAN_FORMS.copy;
const pageCopy = TRIP_PLAN_PAGE.copy;

export default function PlanFormPage({
  form,
  role,
  archived,
  members,
  tally,
  onBack,
  onAnswer,
  onVerb,
}: {
  form: TripPlanFormView;
  role: TripPlanRole;
  archived: boolean;
  /** Everyone in the plan the caller can see, for the table's rows. */
  members: TripPlanMemberView[];
  /** A leader's "3 of 5 answered" lines; none for anyone else. */
  tally: string[];
  onBack: () => void;
  onAnswer: () => void;
  onVerb: (id: PlanFormVerbId) => void;
}) {
  const verbs = planVerbsFor(PLAN_FORM_VERBS, "web", role, { archived });
  const mine = form.myAnswer
    ? currentTripPlanAnswers(form.questions, form.myAnswer.answers)
    : null;
  // Who's going, each with their answer or none, then those asking to join
  // who answered (`tripPlanAnswerTable`, as Logjam GPS draws it).
  const answers = tripPlanAnswerTable(form, members);
  const table = (title: string, people: typeof answers.going) => (
    <div className={classes.block}>
      <SectionHeader title={title} />
      <DataTable
        label={title}
        corner={copy.member}
        columns={answers.columns}
        empty={copy.noAnswerYet}
        rows={people.map(({ user, answered, cells }) => ({
          id: user.id,
          name: user.username,
          cells: answered ? cells : null,
        }))}
      />
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
      // A leader reads who sees the answers and how many are in, as one
      // line; the sentence "your answers" is addressed to a member.
      <p className={classes.note}>
        {role === "leader"
          ? [
              form.visibleTo === "leaders"
                ? pageCopy.seenByLeaders
                : pageCopy.seenByMembers,
              ...tally,
            ].join(" · ")
          : tripPlanVisibilityLine(form.visibleTo, form.preset)}
      </p>
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
        {table(copy.answers, answers.going)}
        {answers.asking.length > 0 && table(copy.asking, answers.asking)}
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
