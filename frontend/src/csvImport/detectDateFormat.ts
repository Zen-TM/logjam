export type DateFormat = "DD/MM/YYYY" | "DD-MM-YYYY" | "DD/MM/YY" | "DD-MM-YY";

export const DATE_FORMAT_LABELS: Record<DateFormat, string> = {
  "DD/MM/YYYY": "DD/MM/YYYY (e.g. 15/06/2023)",
  "DD-MM-YYYY": "DD-MM-YYYY (e.g. 15-06-2023)",
  "DD/MM/YY":   "DD/MM/YY (e.g. 15/06/23)",
  "DD-MM-YY":   "DD-MM-YY (e.g. 15-06-23)",
};

function twoDigitYear(yy: number): number {
  const currentYY = new Date().getFullYear() % 100;
  return yy <= currentYY ? 2000 + yy : 1900 + yy;
}

export function parseWithFormat(s: string, format: DateFormat): Date | null {
  switch (format) {
    case "DD/MM/YYYY": {
      const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (!m) return null;
      const d = new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]));
      return isNaN(d.getTime()) ? null : d;
    }
    case "DD-MM-YYYY": {
      const m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
      if (!m) return null;
      const d = new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]));
      return isNaN(d.getTime()) ? null : d;
    }
    case "DD/MM/YY": {
      const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
      if (!m) return null;
      const year = twoDigitYear(parseInt(m[3]));
      const d = new Date(year, parseInt(m[2]) - 1, parseInt(m[1]));
      return isNaN(d.getTime()) ? null : d;
    }
    case "DD-MM-YY": {
      const m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{2})$/);
      if (!m) return null;
      const year = twoDigitYear(parseInt(m[3]));
      const d = new Date(year, parseInt(m[2]) - 1, parseInt(m[1]));
      return isNaN(d.getTime()) ? null : d;
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

  const all: DateFormat[] = ["DD/MM/YYYY", "DD-MM-YYYY", "DD/MM/YY", "DD-MM-YY"];
  const matching = all.filter((f) => nonEmpty.every((s) => parseWithFormat(s, f) !== null));

  if (matching.length === 0) return { format: "DD/MM/YYYY", ambiguous: true };
  if (matching.length === 1) return { format: matching[0], ambiguous: false };

  // Multiple match (e.g. ambiguous between slash and dash with identical separators) — prefer 4-digit year
  const fourDigit = matching.filter((f) => f.endsWith("YYYY"));
  return { format: fourDigit.length > 0 ? fourDigit[0] : matching[0], ambiguous: true };
}
