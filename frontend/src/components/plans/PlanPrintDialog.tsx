// Print a summary (Logjam Web only, `PLAN_VERBS`): a page for someone not on
// the trip, printed or saved as a PDF by the browser (design §7.7). The
// summary is rendered into `#plan-print`, a child of <body>, only while
// printing; the print stylesheet hides everything else, map and app chrome
// included. It goes on `afterprint`, never when print() returns: Firefox
// returns at once, Chrome only once the dialog closes.
import { useEffect, useEffectEvent, useId, useState } from "react";
import { createPortal } from "react-dom";
import {
  tripPlanDatesLine,
  tripTypeLabel,
  type TripPlanView,
} from "@logjam/shared";
import { Button, Checkbox, Dialog } from "../../ui";
import { planSummary, summaryForm, type SummaryParts } from "./plansModel";
import classes from "./PlanSummary.module.css";

export default function PlanPrintDialog({
  plan,
  onClose,
}: {
  plan: TripPlanView;
  onClose: () => void;
}) {
  const formId = useId();
  const carpool = summaryForm(plan, "carpool");
  const contacts = summaryForm(plan, "safetyContacts");
  const [parts, setParts] = useState<SummaryParts>({
    writeUp: true,
    going: true,
    carpool: carpool != null,
    contacts: contacts != null,
  });
  const [printing, setPrinting] = useState(false);

  // An effect event, so a new `onClose` each render never prints again.
  const done = useEffectEvent(() => {
    setPrinting(false);
    onClose();
  });
  useEffect(() => {
    if (!printing) return;
    window.addEventListener("afterprint", done);
    window.print();
    return () => window.removeEventListener("afterprint", done);
  }, [printing]);

  const set = (key: keyof SummaryParts) => (next: boolean) =>
    setParts((was) => ({ ...was, [key]: next }));

  return (
    <>
      <Dialog
        open={!printing}
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
            setPrinting(true);
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
          {carpool && (
            <Checkbox
              label="Carpooling"
              checked={parts.carpool}
              onChange={set("carpool")}
            />
          )}
          {contacts && (
            <Checkbox
              label="Safety contacts"
              checked={parts.contacts}
              onChange={set("contacts")}
            />
          )}
        </form>
      </Dialog>
      {printing && <PlanSummary plan={plan} parts={parts} />}
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
            {head.map((cell) => (
              <th key={cell} scope="col">
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
      <SummaryTable
        caption="Carpooling"
        head={["Name", "How", "Seats", "Leaving from"]}
        rows={summary.carpool}
      />
      <SummaryTable
        caption="Safety contacts"
        head={["Member", "Contact", "Phone", "Second contact", "Phone"]}
        rows={summary.contacts}
      />
      <footer>
        From Logjam Web, {printed}. Correct when printed; the plan may have
        changed since.
      </footer>
    </div>,
    document.body,
  );
}
