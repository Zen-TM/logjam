// Copy for the guest → account link confirmation.
//
// Pure because it is the last thing a user reads before an irreversible,
// unattended upload, and the numbers in it have to be right. Linking merges
// this phone's data into the account and there is no unlink — a guest with 50
// canyons who signs into an account holding 200 ends up with 250, permanently.
// The confirmation is the only place that can say so.
//
// PRIVACY: counts only. Never a canyon name.
import type { LocalEntityCounts } from "../sync/syncDb";

function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/**
 * "42 canyons, 18 trips and 310 photos" — kinds with nothing in them are
 * dropped rather than reported as zero, so a user who only logs trips isn't
 * told about their 0 canyons.
 *
 * Returns null when there is nothing at all: the caller skips the whole
 * confirmation then, because there is nothing to warn about.
 */
export function describeLocalData(counts: LocalEntityCounts): string | null {
  const parts: string[] = [];
  if (counts.canyons > 0) parts.push(plural(counts.canyons, "canyon", "canyons"));
  if (counts.trips > 0) parts.push(plural(counts.trips, "trip", "trips"));
  if (counts.media > 0) parts.push(plural(counts.media, "photo", "photos"));

  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * The body of the pre-link confirmation. Says three things, in the order that
 * matters: what moves, that it can't be undone, and — only when there is a
 * photo backlog worth warning about — that it will take a while.
 */
export function linkConfirmationMessage(counts: LocalEntityCounts): string | null {
  const summary = describeLocalData(counts);
  if (!summary) return null;

  const base =
    `The ${summary} on this phone will be added to the account you sign in to. ` +
    `This can't be undone.`;

  // A photo upload is presign + PUT + confirm each, and the API is rate
  // limited — a few hundred takes hours, not minutes. Someone who expects it
  // to finish while they watch will conclude it has hung.
  return counts.media >= 25
    ? `${base}\n\nUploading the photos will take a while, and needs a connection. You can keep using Logjam GPS while it runs.`
    : base;
}
