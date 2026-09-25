export type DateFormat =
  | "YYYY-MM-DD"
  | "DD/MM/YYYY"
  | "DD-MM-YYYY"
  | "DD/MM/YY"
  | "DD-MM-YY";

export const DATE_FORMAT_LABELS: Record<DateFormat, string> = {
  "YYYY-MM-DD": "YYYY-MM-DD / ISO 8601 (e.g. 2023-06-15)",
  "DD/MM/YYYY": "DD/MM/YYYY (e.g. 15/06/2023)",
  "DD-MM-YYYY": "DD-MM-YYYY (e.g. 15-06-2023)",
  "DD/MM/YY":   "DD/MM/YY (e.g. 15/06/23)",
  "DD-MM-YY":   "DD-MM-YY (e.g. 15-06-23)",
};

function twoDigitYear(yy: number): number {
  const currentYY = new Date().getFullYear() % 100;
  return yy <= currentYY ? 2000 + yy : 1900 + yy;
}

// JS Date silently normalizes out-of-range components (new Date(2023, 1, 30) →
// Mar 2, not "invalid") — isNaN(d.getTime()) can never catch that, so an
// impossible calendar date (30/02/2023, 31/04/2023) would otherwise roll
// forward into a *different, wrong* date with no signal (FECO-007). Verify the
// constructed Date reports back the exact year/month/day it was built from;
// any mismatch means the input wasn't a real date.
function isExactYMD(d: Date, year: number, month0: number, day: number): boolean {
  return d.getFullYear() === year && d.getMonth() === month0 && d.getDate() === day;
}

export function parseWithFormat(s: string, format: DateFormat): Date | null {
  switch (format) {
    case "YYYY-MM-DD": {
      const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      if (!m) return null;
      const [year, month, day] = [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])];
      const d = new Date(year, month - 1, day);
      return isExactYMD(d, year, month - 1, day) ? d : null;
    }
    case "DD/MM/YYYY": {
      const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (!m) return null;
      const [day, month, year] = [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])];
      const d = new Date(year, month - 1, day);
      return isExactYMD(d, year, month - 1, day) ? d : null;
    }
    case "DD-MM-YYYY": {
      const m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
      if (!m) return null;
      const [day, month, year] = [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])];
      const d = new Date(year, month - 1, day);
      return isExactYMD(d, year, month - 1, day) ? d : null;
    }
    case "DD/MM/YY": {
      const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
      if (!m) return null;
      const [day, month] = [parseInt(m[1]), parseInt(m[2])];
      const year = twoDigitYear(parseInt(m[3]));
      const d = new Date(year, month - 1, day);
      return isExactYMD(d, year, month - 1, day) ? d : null;
    }
    case "DD-MM-YY": {
      const m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{2})$/);
      if (!m) return null;
      const [day, month] = [parseInt(m[1]), parseInt(m[2])];
      const year = twoDigitYear(parseInt(m[3]));
      const d = new Date(year, month - 1, day);
      return isExactYMD(d, year, month - 1, day) ? d : null;
    }
  }
}

export function toIsoDate(s: string, format: DateFormat): string | null {
  const d = parseWithFormat(s, format);
  if (!d) return null;
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${dd}`;
}

export function detectDateFormat(samples: string[]): { format: DateFormat; ambiguous: boolean } {
  const nonEmpty = samples.filter((s) => s.trim() !== "");
  if (nonEmpty.length === 0) return { format: "DD/MM/YYYY", ambiguous: false };

  const all: DateFormat[] = ["YYYY-MM-DD", "DD/MM/YYYY", "DD-MM-YYYY", "DD/MM/YY", "DD-MM-YY"];
  const matching = all.filter((f) => nonEmpty.every((s) => parseWithFormat(s, f) !== null));

  if (matching.length === 0) return { format: "DD/MM/YYYY", ambiguous: true };
  if (matching.length === 1) return { format: matching[0], ambiguous: false };

  // Multiple match (e.g. ambiguous between slash and dash with identical separators) — prefer 4-digit year
  const fourDigit = matching.filter((f) => f.endsWith("YYYY"));
  return { format: fourDigit.length > 0 ? fourDigit[0] : matching[0], ambiguous: true };
}
