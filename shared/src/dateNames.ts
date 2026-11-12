// Short day and month names, English, for dates written by hand: Hermes ships
// no reliable `Intl` names, and Logjam's copy is English on both clients.

/** Sunday first, as `Date#getDay` counts. */
export const SHORT_WEEKDAYS = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
] as const;

/** January first, as `Date#getMonth` counts. */
export const SHORT_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;
