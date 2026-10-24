// Who the map's box tool is drawing for: a LiDAR topo's area, or an export's.
// The two share one tool, and Map tools stay live while it is on, so one
// product can be armed over the other: the last one armed owns the next box
// (boxPick.test.ts).

export type BoxFor = "topo" | "export";

export type BoxPick = BoxFor | null;

export const NO_BOX_PICK: BoxPick = null;

export function armBox(_pick: BoxPick, forWhat: BoxFor): BoxPick {
  return forWhat;
}

/** Off, if it was drawing for `forWhat`; otherwise as it was. */
export function endBox(pick: BoxPick, forWhat: BoxFor): BoxPick {
  return pick === forWhat ? null : pick;
}

/** Where a box drawn now goes, or null when the tool is off. */
export function boxFor(pick: BoxPick): BoxFor | null {
  return pick;
}

export function isPicking(pick: BoxPick, forWhat: BoxFor): boolean {
  return pick === forWhat;
}

/**
 * Whether the rail and the pages are held still while the box is drawn. The
 * export dialog is hidden as a round trip meanwhile, so a page that opened it
 * would bring back the stale form (boxPick.test.ts). TopoDialog's own pick
 * leaves them live, as it always has.
 */
export function boxPickDimsUI(pick: BoxPick): boolean {
  return pick === "export";
}
