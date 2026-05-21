import { DateTime } from "luxon";

export const SYDNEY_TZ = "Australia/Sydney";

/** Returns the start of the current week (Sunday 00:00 Sydney time). */
export function currentWeekStart(now = new Date()): Date {
  const dt = DateTime.fromJSDate(now, { zone: SYDNEY_TZ });
  // Luxon weekday: 1=Mon ... 7=Sun. Days elapsed since last Sunday:
  const daysSinceSunday = dt.weekday === 7 ? 0 : dt.weekday;
  return dt.startOf("day").minus({ days: daysSinceSunday }).toJSDate();
}

/** Returns the next Sunday 00:00 Sydney time (when the quota resets). */
export function nextWeekReset(now = new Date()): Date {
  const dt = DateTime.fromJSDate(now, { zone: SYDNEY_TZ });
  const daysSinceSunday = dt.weekday === 7 ? 0 : dt.weekday;
  return dt.startOf("day").minus({ days: daysSinceSunday }).plus({ weeks: 1 }).toJSDate();
}
