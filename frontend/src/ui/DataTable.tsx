import { useState, type CSSProperties } from "react";
import { Dialog } from "./Dialog";
import classes from "./DataTable.module.css";

export type DataTableRow = {
  id: string;
  /** The pinned first cell. */
  name: string;
  /** One per column, or null for a row with nothing to show (`empty` spans it). */
  cells: string[] | null;
};

/**
 * A row per person, a column per question: the first column stays put while
 * fixed-width columns scroll sideways, and a header or cell is cut at two lines.
 * Pressing one says it whole in a Dialog. A semantic `<table>`, so a screen
 * reader still gets rows and headers. The same shape as Logjam GPS's AnswersTable.
 */
export function DataTable({
  label,
  corner,
  columns,
  rows,
  empty,
}: {
  /** Names the scroll region. */
  label: string;
  /** The pinned column's header. */
  corner: string;
  columns: { id: string; label: string }[];
  rows: DataTableRow[];
  /** Shown across a row whose `cells` is null. */
  empty: string;
}) {
  const [whole, setWhole] = useState<{ title: string; body: string } | null>(
    null,
  );
  const clamped = (text: string, title: string) => (
    <button
      type="button"
      className={classes.cell}
      onClick={() => setWhole({ title, body: text })}
    >
      {text}
    </button>
  );
  return (
    <>
      {/* Scrolled sideways on its own, so a keyboard can reach it. */}
      <div
        className={classes.scroll}
        role="region"
        aria-label={label}
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scroll region is the case the rule's own docs exempt
        tabIndex={0}
      >
        <table
          className={classes.table}
          style={{ "--columns": columns.length } as CSSProperties}
        >
          <thead>
            <tr>
              <th scope="col">{corner}</th>
              {columns.map((column) => (
                <th key={column.id} scope="col">
                  {clamped(column.label, column.label)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ id, name, cells }) => (
              <tr key={id}>
                <th scope="row">{name}</th>
                {cells ? (
                  cells.map((cell, index) => (
                    <td key={columns[index].id}>
                      {clamped(cell, `${name} · ${columns[index].label}`)}
                    </td>
                  ))
                ) : (
                  <td colSpan={columns.length} className={classes.empty}>
                    {empty}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Dialog
        open={whole != null}
        title={whole?.title}
        onClose={() => setWhole(null)}
      >
        <p className={classes.whole}>{whole?.body}</p>
      </Dialog>
    </>
  );
}
