// Plans: the words the TripPlan tables store, the wire shapes of /plans, the
// limits and a validator per write shape, which the API
// refuses with and both clients show live. The columns are plain strings,
// not Postgres enums, so a new word needs no migration; this file is the
// only list.

import { say, type UserSentence } from "./userSentence.js";
import type { MediaItem } from "./media.js";
import type { ForeignFieldValue } from "./fieldValues.js";
import { MAX_TRIP_TYPES_PER_TRIP, TRIP_TYPE_MAX_LENGTH } from "./tripName.js";

/** What a member may do in a plan. A plan can have more than one leader. */
export const TRIP_PLAN_ROLES = ["leader", "editor", "member"] as const;
export type TripPlanRole = (typeof TRIP_PLAN_ROLES)[number];

/**
 * Where a membership stands. "invited": a leader named them by username and
 * they have not joined yet. "requested": they used a link and wait for a
 * leader's approval. "active": in the plan.
 */
export const TRIP_PLAN_MEMBER_STATUSES = [
  "invited",
  "requested",
  "active",
] as const;
export type TripPlanMemberStatus = (typeof TRIP_PLAN_MEMBER_STATUSES)[number];

/** Who may read the answers to a form. */
export const TRIP_PLAN_FORM_VISIBILITIES = ["leaders", "members"] as const;
export type TripPlanFormVisibility =
  (typeof TRIP_PLAN_FORM_VISIBILITIES)[number];

function oneOf<T extends string>(words: readonly T[]) {
  return (value: unknown): value is T =>
    typeof value === "string" && (words as readonly string[]).includes(value);
}

export const isTripPlanRole = oneOf(TRIP_PLAN_ROLES);
export const isTripPlanMemberStatus = oneOf(TRIP_PLAN_MEMBER_STATUSES);
export const isTripPlanFormVisibility = oneOf(TRIP_PLAN_FORM_VISIBILITIES);

// ── Wire shapes ─────────────────────────────────────────────────────

export const TRIP_PLAN_ITEM_KINDS = [
  "place",
  "route",
  "media",
  "geoPdf",
] as const;
export type TripPlanItemKind = (typeof TRIP_PLAN_ITEM_KINDS)[number];

/** "YYYY-MM-DD": a calendar day with no time zone. */
export type DateOnly = string;

export type TripPlanUserRef = { id: string; username: string };

/** One row of GET /plans: every plan the caller is in, invited to or asked to join. */
export type TripPlanSummary = {
  id: string;
  name: string;
  startDate: DateOnly | null;
  endDate: DateOnly | null;
  tripTypes: string[];
  archivedAt: string | null;
  updatedAt: string;
  status: TripPlanMemberStatus;
  /** The caller's role; for invited/requested, the role they will get. */
  role: TripPlanRole;
  /** status "requested": who they wait for. */
  waitingFor?: TripPlanUserRef;
  /** status "invited": who invited them. */
  invitedBy?: TripPlanUserRef;
};

export type TripPlanCreate = {
  name: string;
  startDate?: DateOnly | null;
  endDate?: DateOnly | null;
  tripTypes?: string[];
};

/** GET /plans/:id: everything an active member may see, in one response. */
export type TripPlanView = {
  id: string;
  name: string;
  startDate: DateOnly | null;
  endDate: DateOnly | null;
  tripTypes: string[];
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: TripPlanUserRef | null;
  myRole: TripPlanRole;
  /** By position. */
  sections: TripPlanSectionView[];
  /** Active members for everyone; invited and requested for leaders only. */
  members: TripPlanMemberView[];
  places: TripPlanPlace[];
  /** Standalone and place-linked (placeId set). */
  routes: TripPlanRoute[];
  /** Standalone media. */
  files: TripPlanFile[];
  geoPdfs: TripPlanGeoPdf[];
  /** By position; answers filtered per caller. */
  forms: TripPlanFormView[];
};

export type TripPlanSectionView = {
  id: string;
  title: string;
  body: string;
  position: number;
  updatedAt: string;
};

export type TripPlanMemberView = {
  user: TripPlanUserRef;
  role: TripPlanRole;
  status: TripPlanMemberStatus;
  invitedBy: TripPlanUserRef | null;
  createdAt: string;
};

/** Common to every item. `addedBy` null: the adder deleted their account. */
type TripPlanItemBase = {
  id: string;
  addedBy: TripPlanUserRef | null;
  createdAt: string;
  updatedAt: string;
};

/** Files only: whose storage it counts against. */
type TripPlanFileCharge = {
  /** A bigint, as a string. */
  sizeBytes: string;
  chargedTo: TripPlanUserRef | null;
};

export type TripPlanPlace = TripPlanItemBase & {
  kind: "place";
  name: string;
  altNames: string[];
  latitude: number;
  longitude: number;
  elevation: number | null;
  /** Always a system type. */
  placeTypeId: string;
  notes: string | null;
  /** Keys of the system type's definitions only. */
  fieldValues: Record<string, unknown>;
  /** Read-only, labelled (ADR 0018). */
  foreignFields: ForeignFieldValue[] | null;
  ropeWikiId: number | null;
  /** Photos, presigned (as GET /places/:id). */
  media: (MediaItem & TripPlanFileCharge)[];
};

export type TripPlanRoute = TripPlanItemBase & {
  kind: "route";
  /** A plan place, or null. */
  placeId: string | null;
  name: string;
  color: string;
  points: [number, number][];
  anchors: number[] | null;
};

export type TripPlanFile = TripPlanItemBase &
  TripPlanFileCharge & {
    kind: "media";
    /** The media wire shape, presigned. */
    item: MediaItem;
  };

export type TripPlanGeoPdf = TripPlanItemBase &
  TripPlanFileCharge & {
    kind: "geoPdf";
    title: string;
    downloadUrl: string | null;
    downloadExpiresAt: string | null;
  };

export type TripPlanItem =
  | TripPlanPlace
  | TripPlanRoute
  | TripPlanFile
  | TripPlanGeoPdf;

// ── Limits: one declaration; the API refuses past them, clients show them live

export const TRIP_PLAN_NAME_MAX_LENGTH = 120;
export const TRIP_PLAN_MAX_SECTIONS = 30;
export const TRIP_PLAN_SECTION_TITLE_MAX_LENGTH = 80;
/** Plain text, newlines kept. */
export const TRIP_PLAN_SECTION_BODY_MAX_LENGTH = 20_000;
export const TRIP_PLAN_MAX_FORMS = 20;
export const TRIP_PLAN_FORM_TITLE_MAX_LENGTH = 80;
export const TRIP_PLAN_MAX_QUESTIONS = 40;
export const TRIP_PLAN_QUESTION_LABEL_MAX_LENGTH = 200;
export const TRIP_PLAN_QUESTION_HELP_MAX_LENGTH = 2_000;
export const TRIP_PLAN_MIN_OPTIONS = 2;
export const TRIP_PLAN_MAX_OPTIONS = 30;
export const TRIP_PLAN_OPTION_LABEL_MAX_LENGTH = 80;
export const TRIP_PLAN_TEXT_ANSWER_MAX_LENGTH = 500;
export const TRIP_PLAN_LONG_TEXT_ANSWER_MAX_LENGTH = 4_000;
/** Trip types reuse MAX_TRIP_TYPES_PER_TRIP and TRIP_TYPE_MAX_LENGTH. */

// ── Forms ───────────────────────────────────────────────────────────

export const TRIP_PLAN_QUESTION_KINDS = [
  /** One line. */
  "text",
  /** A paragraph. */
  "longText",
  /** One line, phone keyboard; stored as typed. */
  "phone",
  /** A whole number, 0 or more. */
  "number",
  /** One of `options`. */
  "choice",
  /** Any of `options`. */
  "multiChoice",
  "yesNo",
  /** One box that must be ticked when the question is required. */
  "agree",
] as const;
export type TripPlanQuestionKind = (typeof TRIP_PLAN_QUESTION_KINDS)[number];
export const isTripPlanQuestionKind = oneOf(TRIP_PLAN_QUESTION_KINDS);

export type TripPlanQuestionOption = { id: string; label: string };

export type TripPlanQuestion = {
  /** Client-minted, stable across edits, unique in its form. */
  id: string;
  kind: TripPlanQuestionKind;
  label: string;
  /** One plain sentence under the label. */
  help?: string;
  required: boolean;
  /** choice and multiChoice only. */
  options?: TripPlanQuestionOption[];
};

/** questionId → value. text, longText, phone: string; number: number;
 *  choice: an option id; multiChoice: option ids; yesNo: boolean; agree: true. */
export type TripPlanAnswerValue = string | number | boolean | string[];
export type TripPlanAnswers = Record<string, TripPlanAnswerValue>;

export type TripPlanAnswerView = {
  user: TripPlanUserRef;
  answers: TripPlanAnswers;
  updatedAt: string;
};

export type TripPlanFormView = {
  id: string;
  title: string;
  preset: TripPlanFormPresetId | null;
  questions: TripPlanQuestion[];
  visibleTo: TripPlanFormVisibility;
  requiredToJoin: boolean;
  position: number;
  updatedAt: string;
  /** The caller's own answer, always; null if none. */
  myAnswer: TripPlanAnswerView | null;
  /** Everyone else's: leaders get all; others only when visibleTo is "members". */
  answers: TripPlanAnswerView[];
};

export type TripPlanFormCreate = {
  title: string;
  preset?: TripPlanFormPresetId | null;
  questions: TripPlanQuestion[];
  visibleTo: TripPlanFormVisibility;
  requiredToJoin: boolean;
};

export const TRIP_PLAN_FORM_PRESET_IDS = [
  "gear",
  "carpool",
  "experience",
  "firstAid",
  "safetyContacts",
  "rules",
] as const;
export type TripPlanFormPresetId = (typeof TRIP_PLAN_FORM_PRESET_IDS)[number];
export const isTripPlanFormPresetId = oneOf(TRIP_PLAN_FORM_PRESET_IDS);

// ── Compare-and-set ─────────────────────────────────────────────────

/** A field a save changes: the value the client last saw, and the new one. */
export type Cas<T> = { from: T; to: T };

export type TripPlanDates = {
  startDate: DateOnly | null;
  endDate: DateOnly | null;
};

export type TripPlanPatch = {
  name?: Cas<string>;
  dates?: Cas<TripPlanDates>;
  tripTypes?: Cas<string[]>;
};

export type TripPlanSectionCreate = { title: string; body: string };
export type TripPlanSectionPatch = {
  title?: Cas<string>;
  body?: Cas<string>;
};

/** What the API answers when a compare-and-set finds the row changed. */
export const TRIP_PLAN_CHANGED_SENTENCE = say`Not saved: someone else changed this. Check their change, then save yours again.`;

// ── Validators: one per write shape, run by the API and by both clients ──

/**
 * Why a write is refused: a sentence the person reads (400, or 413 for a
 * count over its cap), or a shape only a broken client sends, whose detail
 * never holds what the person wrote (it is logged).
 * Guard: tripPlans.test.ts ("never echoes").
 */
export type TripPlanRefusal =
  | { sentence: UserSentence; status: 400 | 413 }
  | { malformed: string; status?: 413 };
export type TripPlanParsed<T> = { value: T } | TripPlanRefusal;

class Refused {
  constructor(readonly refusal: TripPlanRefusal) {}
}
function refuse(sentence: UserSentence, status: 400 | 413 = 400): never {
  throw new Refused({ sentence, status });
}
function bad(detail: string, status?: 413): never {
  throw new Refused(
    status ? { malformed: detail, status } : { malformed: detail },
  );
}
function checked<T>(parse: () => T): TripPlanParsed<T> {
  try {
    return { value: parse() };
  } catch (error) {
    if (error instanceof Refused) return error.refusal;
    throw error;
  }
}

function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    bad(`${what} must be an object`);
  return value as Record<string, unknown>;
}

function text(value: unknown, what: string): string {
  if (typeof value !== "string") bad(`${what} must be a string`);
  return value;
}

/** A Cas pair's shape; `to` is checked by the caller with the create rules. */
function cas(value: unknown, what: string): { from: unknown; to: unknown } {
  const pair = record(value, what);
  if (!("from" in pair) || !("to" in pair)) bad(`${what} needs from and to`);
  return { from: pair.from, to: pair.to };
}

function nothingToChange(patch: object): void {
  if (Object.keys(patch).length === 0) bad("the patch changes nothing");
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar day as "YYYY-MM-DD". */
export function isDateOnly(value: unknown): value is DateOnly {
  if (typeof value !== "string" || !DATE_ONLY.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

function dateOrNull(value: unknown, what: string): DateOnly | null {
  if (value === undefined || value === null) return null;
  if (!isDateOnly(value)) bad(`${what} must be YYYY-MM-DD or null`);
  return value;
}

function planName(value: unknown): string {
  const name = text(value, "name").trim();
  if (!name) refuse(say`Give the plan a name.`);
  if (name.length > TRIP_PLAN_NAME_MAX_LENGTH)
    refuse(
      say`A plan's name can be up to ${TRIP_PLAN_NAME_MAX_LENGTH} characters.`,
    );
  return name;
}

function planDates(value: unknown): TripPlanDates {
  const dates = record(value, "dates");
  const startDate = dateOrNull(dates.startDate, "startDate");
  const endDate = dateOrNull(dates.endDate, "endDate");
  // Strings compare as days: both are YYYY-MM-DD.
  if (startDate && endDate && endDate < startDate)
    refuse(say`The trip can't end before it starts.`);
  return { startDate, endDate };
}

function tripTypes(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) bad(`${field} must be an array of strings`);
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const type = text(item, `${field} entry`).trim();
    if (!type) bad(`${field} entries must not be empty`);
    if (type.length > TRIP_TYPE_MAX_LENGTH)
      refuse(say`A trip type can be up to ${TRIP_TYPE_MAX_LENGTH} characters.`);
    const key = type.toLowerCase();
    if (seen.has(key))
      refuse(
        say`This trip has the same type twice. Remove one and save again.`,
      );
    seen.add(key);
    result.push(type);
  }
  if (result.length > MAX_TRIP_TYPES_PER_TRIP)
    refuse(say`A trip can have up to ${MAX_TRIP_TYPES_PER_TRIP} types.`, 413);
  return result;
}

/**
 * A list of trip types, as a trip log, a plan and a trip attribute's scoping
 * all take it: trimmed, none empty, no two the same ignoring case, capped.
 * `field` names the list in a malformed detail. The API's `parseTripTypes`
 * (routes/tripLogsGlobal.ts) is this plus its undefined/null handling.
 */
export function parseTripTypeList(
  value: unknown,
  field: string,
): TripPlanParsed<string[]> {
  return checked(() => tripTypes(value, field));
}

function stringList(value: unknown, what: string): string[] {
  if (!Array.isArray(value)) bad(`${what} must be an array of strings`);
  return value.map((item) => text(item, what));
}

/** POST /plans. */
export function parseTripPlanCreate(
  body: unknown,
): TripPlanParsed<Required<TripPlanCreate>> {
  return checked(() => {
    const input = record(body, "body");
    return {
      name: planName(input.name),
      ...planDates({ startDate: input.startDate, endDate: input.endDate }),
      tripTypes:
        input.tripTypes === undefined || input.tripTypes === null
          ? []
          : tripTypes(input.tripTypes, "tripTypes"),
    };
  });
}

/** PATCH /plans/:id. */
export function parseTripPlanPatch(
  body: unknown,
): TripPlanParsed<TripPlanPatch> {
  return checked(() => {
    const input = record(body, "body");
    const patch: TripPlanPatch = {};
    if (input.name !== undefined) {
      const { from, to } = cas(input.name, "name");
      patch.name = { from: text(from, "name.from"), to: planName(to) };
    }
    if (input.dates !== undefined) {
      const { from, to } = cas(input.dates, "dates");
      const was = record(from, "dates.from");
      patch.dates = {
        from: {
          startDate: dateOrNull(was.startDate, "dates.from.startDate"),
          endDate: dateOrNull(was.endDate, "dates.from.endDate"),
        },
        to: planDates(to),
      };
    }
    if (input.tripTypes !== undefined) {
      const { from, to } = cas(input.tripTypes, "tripTypes");
      const was = stringList(from, "tripTypes.from");
      if (was.length > MAX_TRIP_TYPES_PER_TRIP)
        bad("tripTypes.from is over the cap", 413);
      patch.tripTypes = { from: was, to: tripTypes(to, "tripTypes") };
    }
    nothingToChange(patch);
    return patch;
  });
}

function sectionTitle(value: unknown): string {
  const title = text(value, "title").trim();
  if (!title) refuse(say`Give the section a title.`);
  if (title.length > TRIP_PLAN_SECTION_TITLE_MAX_LENGTH)
    refuse(
      say`A section's title can be up to ${TRIP_PLAN_SECTION_TITLE_MAX_LENGTH} characters.`,
    );
  return title;
}

function sectionBody(value: unknown): string {
  // Leading spaces may be the writer's indent; only the end is trimmed.
  const body = text(value, "body").trimEnd();
  if (body.length > TRIP_PLAN_SECTION_BODY_MAX_LENGTH)
    refuse(
      say`A section can be up to ${TRIP_PLAN_SECTION_BODY_MAX_LENGTH} characters. Split it into two.`,
    );
  return body;
}

/** POST /plans/:id/sections. */
export function parseTripPlanSectionCreate(
  body: unknown,
): TripPlanParsed<TripPlanSectionCreate> {
  return checked(() => {
    const input = record(body, "body");
    return {
      title: sectionTitle(input.title),
      body: input.body === undefined ? "" : sectionBody(input.body),
    };
  });
}

/** PATCH /plans/:id/sections/:sectionId. */
export function parseTripPlanSectionPatch(
  body: unknown,
): TripPlanParsed<TripPlanSectionPatch> {
  return checked(() => {
    const input = record(body, "body");
    const patch: TripPlanSectionPatch = {};
    if (input.title !== undefined) {
      const { from, to } = cas(input.title, "title");
      patch.title = { from: text(from, "title.from"), to: sectionTitle(to) };
    }
    if (input.body !== undefined) {
      const { from, to } = cas(input.body, "body");
      patch.body = { from: text(from, "body.from"), to: sectionBody(to) };
    }
    nothingToChange(patch);
    return patch;
  });
}

/** PUT …/order: every id once. Whether they are the current set is the API's check. */
export function parseTripPlanOrder(
  body: unknown,
  max: number,
): TripPlanParsed<string[]> {
  return checked(() => {
    const ids = stringList(record(body, "body").ids, "ids");
    if (ids.length === 0) bad("ids is empty");
    if (ids.length > max) bad("ids is over the cap", 413);
    if (new Set(ids).size !== ids.length) bad("ids repeats an id");
    return ids;
  });
}
