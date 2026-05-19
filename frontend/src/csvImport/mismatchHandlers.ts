import type { MismatchKind } from "./mismatchDetection";
import { parseDms } from "./canyonValueParsers";

export type HandlerResult = number | string | string[] | null;

export type MismatchHandler = {
  id: string;
  label: string;
  apply: (raw: string) => HandlerResult;
};

// Universal handlers always available for every mismatch
export const DISCARD_COLUMN_ID = "discardColumn";
export const STORE_AS_ATTR_ID = "storeAsCustomAttribute";
export const LEAVE_BLANK_ID = "leaveBlankForBadRows";

const discardColumn: MismatchHandler = {
  id: DISCARD_COLUMN_ID,
  label: "Discard column",
  apply: () => null,
};

const storeAsCustomAttribute: MismatchHandler = {
  id: STORE_AS_ATTR_ID,
  label: "Store as custom attribute",
  apply: (raw) => raw,
};

// leaveBlankForBadRows only shown when partial; apply returns null for bad rows
const leaveBlankForBadRows: MismatchHandler = {
  id: LEAVE_BLANK_ID,
  label: "Leave blank for bad rows",
  apply: () => null,
};

// Per-kind handler registries
const KIND_HANDLERS: Record<MismatchKind, MismatchHandler[]> = {
  decimalInInt: [
    {
      id: "round",
      label: "Round to nearest integer",
      apply: (raw) => Math.round(Number(raw)),
    },
    {
      id: "floor",
      label: "Floor (round down)",
      apply: (raw) => Math.floor(Number(raw)),
    },
    {
      id: "ceil",
      label: "Ceiling (round up)",
      apply: (raw) => Math.ceil(Number(raw)),
    },
  ],

  outOfRange: [
    {
      id: "clamp",
      label: "Clamp to valid range",
      apply: (raw) => Number(raw), // clamping applied in the dialog based on role range
    },
    {
      id: "discardOutOfRangeCells",
      label: "Leave blank for out-of-range values",
      apply: () => null,
    },
  ],

  scaleMismatch: [
    {
      id: "rescaleLinear",
      label: "Rescale proportionally (e.g. 1–10 → 1–5)",
      apply: (raw) => Math.round(Number(raw)), // actual rescale applied in dialog with known range
    },
    {
      id: "divideBy2Round",
      label: "Divide by 2 and round",
      apply: (raw) => Math.round(Number(raw) / 2),
    },
    {
      id: "divideBy10Round",
      label: "Divide by 10 and round",
      apply: (raw) => Math.round(Number(raw) / 10),
    },
  ],

  nonNumeric: [
    // manualLookupTable handler — apply is overridden dynamically in the dialog
    {
      id: "manualLookupTable",
      label: "Map values manually (enter translations below)",
      apply: () => null,
    },
  ],

  unparsableArray: [
    {
      id: "splitOnSemicolon",
      label: "Split on semicolon ( ; )",
      apply: (raw) => raw.split(";").map((s) => s.trim()).filter(Boolean),
    },
    {
      id: "splitOnPipe",
      label: "Split on pipe ( | )",
      apply: (raw) => raw.split("|").map((s) => s.trim()).filter(Boolean),
    },
    {
      id: "splitOnNewline",
      label: "Split on newline",
      apply: (raw) => raw.split("\n").map((s) => s.trim()).filter(Boolean),
    },
    {
      id: "treatAsRawString",
      label: "Treat as single value",
      apply: (raw) => [raw.trim()].filter(Boolean),
    },
  ],

  unparsableJson: [
    {
      id: "treatAsRawString",
      label: "Treat as plain text",
      apply: (raw) => raw.trim(),
    },
  ],

  coordFormat: [
    {
      id: "parseDms",
      label: "Parse degrees°minutes′seconds″ format",
      apply: (raw) => parseDms(raw) ?? null,
    },
    {
      id: "parseSignedDecimal",
      label: "Parse as signed decimal",
      apply: (raw) => {
        const n = Number(raw.trim().replace(/[°'"NSEWnsew\s]/g, ""));
        return isNaN(n) ? null : n;
      },
    },
    {
      id: "swapLatLng",
      label: "Values look like longitude/latitude — swap columns instead",
      apply: (raw) => Number(raw.trim()),
    },
  ],

  booleanish: [
    {
      id: "mapYesNoToOneZero",
      label: "yes/y → 1, no/n → 0",
      apply: (raw) => {
        const lower = raw.trim().toLowerCase();
        if (["yes", "y", "true"].includes(lower)) return 1;
        if (["no", "n", "false"].includes(lower)) return 0;
        return null;
      },
    },
    {
      id: "mapTrueFalseToOneZero",
      label: "true → 1, false → 0",
      apply: (raw) => {
        const lower = raw.trim().toLowerCase();
        return lower === "true" ? 1 : lower === "false" ? 0 : null;
      },
    },
  ],

  mixedTypes: [
    {
      id: "discardBadCells",
      label: "Keep parseable values, leave others blank",
      apply: () => null, // fallback; dialog applies per-cell parse first
    },
    {
      id: "treatAllAsString",
      label: "Treat entire column as text (store as custom attribute)",
      apply: (raw) => raw,
    },
  ],

  emptyDominant: [], // informational only — no transforms
};

export function getHandlers(
  kind: MismatchKind,
  isPartial: boolean,
): MismatchHandler[] {
  const specific = KIND_HANDLERS[kind] ?? [];
  const universals: MismatchHandler[] = [storeAsCustomAttribute, discardColumn];
  if (isPartial) universals.unshift(leaveBlankForBadRows);
  return [...specific, ...universals];
}

export function getDefaultHandlerId(kind: MismatchKind): string {
  const handlers = KIND_HANDLERS[kind];
  if (handlers && handlers.length > 0) return handlers[0].id;
  return LEAVE_BLANK_ID;
}
