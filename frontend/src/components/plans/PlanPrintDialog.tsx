// Print a summary (Logjam Web only, `PLAN_VERBS`): a page for someone not on
// the trip, printed or saved as a PDF by the browser. The summary sits in
// `#plan-print`, a child of <body>, while the dialog is open; the print
// stylesheet hides everything else then, the dialog, map and app chrome
// included. `afterprint` closes the dialog where it fires, never print()'s
// return: Firefox returns at once, Chrome once its dialog closes.
import { useEffect, useEffectEvent, useId, useState } from "react";
import { createPortal } from "react-dom";
import {
  TRIP_PLAN_FORM_PRESETS,
  tripPlanDatesLine,
  tripTypeLabel,
  type TripPlanFormPresetId,
  type TripPlanView,
} from "@logjam/shared";
import { Button, Checkbox, Dialog } from "../../ui";
import { planSummary, summaryForms, type SummaryParts } from "./plansModel";
import classes from "./PlanSummary.module.css";

export default function PlanPrintDialog({
  plan,
  onClose,
}: {
  plan: TripPlanView;
  onClose: () => void;
}) {
  const formId = useId();
  const printable = summaryForms(plan);
  const [parts, setParts] = useState<SummaryParts>({
    writeUp: true,
    going: true,
    presets: printable.map((form) => form.preset),
  });

  // An effect event, so a new `onClose` each render never re-subscribes.
  const done = useEffectEvent(onClose);
  useEffect(() => {
    window.addEventListener("afterprint", done);
    return () => window.removeEventListener("afterprint", done);
  }, []);

  const set = (key: "writeUp" | "going") => (next: boolean) =>
    setParts((was) => ({ ...was, [key]: next }));
  const tick = (preset: TripPlanFormPresetId) => (next: boolean) =>
    setParts((was) => ({
      ...was,
      presets: next
        ? [...was.presets, preset]
        : was.presets.filter((each) => each !== preset),
    }));

  return (
    <>
      <Dialog
        open
        title="Print a summary"
        onClose={onClose}
        footer={
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button type="submit" form={formId} variant="filled" icon="print">
              Print or save as PDF
            </Button>
          </>
        }
      >
        <form
          id={formId}
          className={classes.choices}
          onSubmit={(event) => {
            event.preventDefault();
            window.print();
          }}
        >
          <p className={classes.line}>
            For someone not on the trip, such as a parent. It&rsquo;s a file you
            keep or send, not a link.
          </p>
          <Checkbox
            label="Write-up"
            checked={parts.writeUp}
            onChange={set("writeUp")}
          />
          <Checkbox
            label="Who's going"
            checked={parts.going}
            onChange={set("going")}
          />
          {printable.map((form) => (
            <Checkbox
              key={form.preset}
              label={TRIP_PLAN_FORM_PRESETS[form.preset].title}
              checked={parts.presets.includes(form.preset)}
              onChange={tick(form.preset)}
            />
          ))}
        </form>
      </Dialog>
      <PlanSummary plan={plan} parts={parts} />
    </>
  );
}

function SummaryTable({
  caption,
  head,
  rows,
}: {
  caption: string;
  head: string[];
  rows: string[][];
}) {
  if (rows.length === 0) return null;
  return (
    <section>
      <h2>{caption}</h2>
      <table>
        <thead>
          <tr>
            {head.map((cell, index) => (
              <th key={index} scope="col">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, at) => (
                <td key={at}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function PlanSummary({
  plan,
  parts,
}: {
  plan: TripPlanView;
  parts: SummaryParts;
}) {
  const summary = planSummary(plan, parts);
  const printed = new Date().toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return createPortal(
    <div id="plan-print" className={classes.summary}>
      <h1>{summary.name}</h1>
      <p>{tripPlanDatesLine(plan, "member", tripTypeLabel)}</p>
      {summary.leaders.length > 0 && (
        <p>Leaders: {summary.leaders.join(", ")}</p>
      )}
      {summary.sections.map((section, index) => (
        <section key={index}>
          <h2>{section.title}</h2>
          <p className={classes.body}>{section.body}</p>
        </section>
      ))}
      <SummaryTable
        caption="Who's going"
        head={["Name", "Role"]}
        rows={summary.going}
      />
      {summary.tables.map(({ preset, ...table }) => (
        <SummaryTable key={preset} {...table} />
      ))}
      <footer>
        From Logjam Web, {printed}. Correct when printed; the plan may have
        changed since.
      </footer>
    </div>,
    document.body,
  );
}
