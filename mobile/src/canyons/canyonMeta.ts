// Canyon identity and row copy for the Canyons screen.
//
// The screen's organising idea is a tick list: a canyon is either one you've
// run, one you haven't, or one a friend shared with you. Those three states are
// a true partition of the list — a shared canyon can never be "done", because a
// trip can only link to its own owner's canyons — so they double as the filter
// rail's buckets and as the per-row glyph/hue (DESIGN.md §3).
//
// PRIVACY: every helper here reads names, grades and tallies. None of them
// touches latitude/longitude — a canyon's position never reaches a list row
// (DESIGN.md §11).
import type { Feather } from "@expo/vector-icons";
import { formatCanyonGrade } from "@logjam/shared";

import { canyonHue } from "../theme";

export type CanyonStatus = "done" | "todo" | "shared";

export type CanyonStatusMeta = {
  /** Rail chip label. */
  label: string;
  icon: React.ComponentProps<typeof Feather>["name"];
  hue: string;
};

export const CANYON_STATUS_META: Record<CanyonStatus, CanyonStatusMeta> = {
  done: { label: "Done", icon: "check-circle", hue: canyonHue.done },
  todo: { label: "To do", icon: "map-pin", hue: canyonHue.todo },
  shared: { label: "Shared", icon: "users", hue: canyonHue.shared },
};

/**
 * `tripCount` is the viewer's OWN linked-trip count, derived locally from the
 * mirrored trip logs. On a canyon shared with the viewer it is structurally
 * zero (they cannot link a trip to someone else's canyon), and the owner's
 * tally never reaches this device — so "shared" wins over any count.
 */
export function canyonStatus(
  canyon: { syncRole: "owner" | "shared" },
  tripCount: number,
): CanyonStatus {
  if (canyon.syncRole === "shared") return "shared";
  return tripCount > 0 ? "done" : "todo";
}

export type CanyonSummaryFields = {
  vGrade: number | null;
  aGrade: number | null;
  commitment: number | null;
  numAbseils: number | null;
  longestAbseil: number | null;
  hours: number | null;
};

/**
 * The row's second line: what you'd want to know before committing a Saturday.
 * Grade first (it is the shorthand every canyoner reads first), then the two
 * logistics numbers that decide whether today is the day — how long, and
 * whether your rope reaches.
 *
 * Only states what is known. A canyon imported with no grades gets a short
 * line rather than a row of "—" placeholders.
 *
 * Capped at three facts, in priority order: a fourth doesn't fit a row beside
 * the rating and the overflow button, and ellipsising mid-number ("3 abse…")
 * tells the reader less than leaving it out.
 */
const SUMMARY_FACTS = 3;

export function canyonSummary(canyon: CanyonSummaryFields): string {
  return [
    formatCanyonGrade(canyon),
    canyon.hours != null ? `${trimNumber(canyon.hours)} h` : null,
    canyon.longestAbseil != null ? `${trimNumber(canyon.longestAbseil)} m max` : null,
    canyon.numAbseils != null ? `${canyon.numAbseils} abseils` : null,
  ]
    .filter((part): part is string => Boolean(part))
    .slice(0, SUMMARY_FACTS)
    .join(" · ");
}

/** Quality as a compact rating, e.g. "★ 4". Null when unrated — an absent
 * rating is not a zero-star one. */
export function qualityLabel(quality: number | null | undefined): string | null {
  if (quality == null) return null;
  return `★ ${trimNumber(quality)}`;
}

/** 4 not "4.0", but 3.5 stays 3.5 — grades and hours are stored as floats. */
function trimNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10);
}
