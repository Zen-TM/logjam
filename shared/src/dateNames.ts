// Weekday and month names, written by hand because Hermes ships no reliable
// `Intl` names. Each is a message, so a language can spell it its own way.
// Dates are put together from them in dateFormat.ts.
import { t } from "./i18n.js";

const SHORT_WEEKDAYS = [
  () => t`Sun`,
  () => t`Mon`,
  () => t`Tue`,
  () => t`Wed`,
  () => t`Thu`,
  () => t`Fri`,
  () => t`Sat`,
];

const LONG_WEEKDAYS = [
  () => t`Sunday`,
  () => t`Monday`,
  () => t`Tuesday`,
  () => t`Wednesday`,
  () => t`Thursday`,
  () => t`Friday`,
  () => t`Saturday`,
];

// "Sept" is how en-AU writes it, as the runtimes' own `Intl` does.
const SHORT_MONTHS = [
  () => t`Jan`,
  () => t`Feb`,
  () => t`Mar`,
  () => t`Apr`,
  () => t`May`,
  () => t`Jun`,
  () => t`Jul`,
  () => t`Aug`,
  () => t`Sept`,
  () => t`Oct`,
  () => t`Nov`,
  () => t`Dec`,
];

const LONG_MONTHS = [
  () => t`January`,
  () => t`February`,
  () => t`March`,
  () => t`April`,
  () => t`May`,
  () => t`June`,
  () => t`July`,
  () => t`August`,
  () => t`September`,
  () => t`October`,
  () => t`November`,
  () => t`December`,
];

const MONTH_INITIALS = [
  () => t`J`,
  () => t`F`,
  () => t`M`,
  () => t`A`,
  () => t`M`,
  () => t`J`,
  () => t`J`,
  () => t`A`,
  () => t`S`,
  () => t`O`,
  () => t`N`,
  () => t`D`,
];

/** `index` is `Date#getDay`'s: Sunday is 0. A number outside 0-6 reads as an empty string. */
export const shortWeekday = (index: number): string =>
  SHORT_WEEKDAYS[index]?.() ?? "";

export const longWeekday = (index: number): string =>
  LONG_WEEKDAYS[index]?.() ?? "";

/** `index` is `Date#getMonth`'s: January is 0. A number outside 0-11 reads as an empty string. */
export const shortMonth = (index: number): string =>
  SHORT_MONTHS[index]?.() ?? "";

export const longMonth = (index: number): string =>
  LONG_MONTHS[index]?.() ?? "";

/** One letter, for a chart axis with room for no more. */
export const monthInitial = (index: number): string =>
  MONTH_INITIALS[index]?.() ?? "";
