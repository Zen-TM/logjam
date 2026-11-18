import { t } from "@logjam/shared";

/** Which of three counts are above zero, as 4 | 2 | 1, to pick one whole message. */
const mask = (a: number, b: number, c: number) =>
  (a > 0 ? 4 : 0) | (b > 0 ? 2 : 0) | (c > 0 ? 1 : 0);

/** The toast after a RopeWiki refresh: what was added, linked and updated, each count a sentence of its own. */
export function importSummary(
  added: number,
  linked: number,
  updated: number,
): string {
  switch (mask(added, linked, updated)) {
    case 7:
      return t`RopeWiki import: ${added} added, ${linked} linked, ${updated} updated`;
    case 6:
      return t`RopeWiki import: ${added} added, ${linked} linked`;
    case 5:
      return t`RopeWiki import: ${added} added, ${updated} updated`;
    case 4:
      return t`RopeWiki import: ${added} added`;
    case 3:
      return t`RopeWiki import: ${linked} linked, ${updated} updated`;
    case 2:
      return t`RopeWiki import: ${linked} linked`;
    case 1:
      return t`RopeWiki import: ${updated} updated`;
    default:
      return t`RopeWiki import: no new places`;
  }
}

/** The review dialog's note on what the refresh already did, or "" when it did nothing. */
export function autoImportedLine(
  added: number,
  linked: number,
  updated: number,
): string {
  switch (mask(added, linked, updated)) {
    case 7:
      return t`Already imported automatically: ${added} added, ${linked} linked to existing, ${updated} updated.`;
    case 6:
      return t`Already imported automatically: ${added} added, ${linked} linked to existing.`;
    case 5:
      return t`Already imported automatically: ${added} added, ${updated} updated.`;
    case 4:
      return t`Already imported automatically: ${added} added.`;
    case 3:
      return t`Already imported automatically: ${linked} linked to existing, ${updated} updated.`;
    case 2:
      return t`Already imported automatically: ${linked} linked to existing.`;
    case 1:
      return t`Already imported automatically: ${updated} updated.`;
    default:
      return "";
  }
}

/** The toast after the review is applied. */
export function reviewAppliedToast(
  created: number,
  linked: number,
  skipped: number,
): string {
  switch (mask(created, linked, skipped)) {
    case 7:
      return t`Review applied: ${created} created, ${linked} linked, ${skipped} skipped.`;
    case 6:
      return t`Review applied: ${created} created, ${linked} linked.`;
    case 5:
      return t`Review applied: ${created} created, ${skipped} skipped.`;
    case 4:
      return t`Review applied: ${created} created.`;
    case 3:
      return t`Review applied: ${linked} linked, ${skipped} skipped.`;
    case 2:
      return t`Review applied: ${linked} linked.`;
    case 1:
      return t`Review applied: ${skipped} skipped.`;
    default:
      return t`Review applied.`;
  }
}
