// How old the phone's copy of the account is, for the Offline pill: nothing
// until it is over a day ("Offline · synced Sat"), because within a day the
// pill's own word is the whole answer.
import { SHORT_MONTHS, SHORT_WEEKDAYS } from "@logjam/shared";

const DAY_MS = 24 * 60 * 60 * 1000;

/** "synced Sat" within a week, "synced 12 Oct" beyond it, null within a day or
 *  when there is nothing to date. In the phone's time zone, by hand because
 *  Hermes ships no reliable `Intl` weekday names. */
export function syncAgeLabel(
  lastSyncAt: string | null,
  now = Date.now(),
): string | null {
  const then = lastSyncAt ? new Date(lastSyncAt) : null;
  if (!then || Number.isNaN(then.getTime())) return null;
  const elapsed = now - then.getTime();
  if (elapsed <= DAY_MS) return null;
  return elapsed < 7 * DAY_MS
    ? `synced ${SHORT_WEEKDAYS[then.getDay()]}`
    : `synced ${then.getDate()} ${SHORT_MONTHS[then.getMonth()]}`;
}
