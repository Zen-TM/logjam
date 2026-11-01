// Plans: the words the TripPlan tables store, the wire shapes of /plans, the
// limits, the form presets and a validator per write shape, which the API
// refuses with and both clients show live. The columns are plain strings,
// not Postgres enums, so a new word needs no migration; this file is the
// only list.

import { say, type UserSentence } from "./userSentence.js";
import type { MediaItem } from "./media.js";
import type { ForeignFieldValue } from "./fieldValues.js";
import { MAX_TRIP_TYPES_PER_TRIP, TRIP_TYPE_MAX_LENGTH } from "./tripName.js";
import { PLACE_MAX_ALT_NAMES } from "./placeValidation.js";
import {
  MAX_ROUTE_POINTS,
  MIN_ROUTE_POINTS,
  parseRouteAnchors,
  parseRoutePoints,
  ROUTE_ERRORS,
} from "./routeValidation.js";

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

export const TRIP_PLAN_ITEM_KINDS = ["place", "route", "media"] as const;
export type TripPlanItemKind = (typeof TRIP_PLAN_ITEM_KINDS)[number];
export const isTripPlanItemKind = oneOf(TRIP_PLAN_ITEM_KINDS);

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

export type TripPlanItem = TripPlanPlace | TripPlanRoute | TripPlanFile;

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

/**
 * PUT …/answers/me: the answers, and the form as the person was shown it.
 * The API refuses the answer (409) if who sees the answers has changed
 * since, so an answer never reaches more people than its author was told;
 * then if the form changed at all (a question added or made required, a
 * kind changed), so the person answers the form as it is.
 * Guard: api/src/__tests__/planForms.test.ts ("never widening who sees an
 * answer", "asks the person to check a form that changed while they answered").
 */
export type TripPlanAnswerPut = {
  answers: TripPlanAnswers;
  /** The form's `visibleTo` as shown. */
  visibleTo: TripPlanFormVisibility;
  /** The form's `updatedAt` as served (TripPlanFormView.updatedAt). */
  formUpdatedAt: string;
};

// ── Members, invites and joining ────────────────────────────────────

/** How long a plan invite link works, in days. */
export const TRIP_PLAN_INVITE_TTL_DAYS = 7;

/** A leader's view of one of the plan's links: never the link itself. */
export type TripPlanInviteView = {
  id: string;
  createdAt: string;
  expiresAt: string;
  createdBy: TripPlanUserRef | null;
};

/** A form required to join, as a joiner sees it: never anyone's answers.
 *  The joiner echoes `visibleTo` and `updatedAt` (as `formUpdatedAt`);
 *  `preset` tells them a members form may be printed
 *  (`tripPlanVisibilityLine`). */
export type TripPlanJoinForm = Pick<
  TripPlanFormView,
  "id" | "title" | "preset" | "questions" | "visibleTo" | "updatedAt"
>;

/** GET /plans/:id/preview: someone a leader invited by username. */
export type TripPlanInvitedPreview = {
  id: string;
  name: string;
  startDate: DateOnly | null;
  endDate: DateOnly | null;
  tripTypes: string[];
  invitedBy: TripPlanUserRef | null;
  sections: TripPlanSectionView[];
  /** Active members only. */
  members: TripPlanUserRef[];
  requiredForms: TripPlanJoinForm[];
};

/** POST /plan-invites/preview: someone holding a link. No members, no content. */
export type TripPlanLinkPreview = {
  planId: string;
  name: string;
  startDate: DateOnly | null;
  endDate: DateOnly | null;
  /** Who a request would wait for. */
  leader: TripPlanUserRef;
  requiredForms: TripPlanJoinForm[];
  /** The caller's membership already, if any. */
  membership: TripPlanMemberStatus | null;
};

/**
 * POST /plans/:id/join and /plan-invites/redeem: formId → the answers, and
 * the form as shown, checked as the answer PUT checks it. Covers every form
 * required to join.
 */
export type TripPlanJoinAnswers = Record<
  string,
  {
    answers: TripPlanAnswers;
    visibleTo: TripPlanFormVisibility;
    formUpdatedAt: string;
  }
>;

/** POST /plan-invites/redeem. */
export type TripPlanRedeemResult =
  | { planId: string; status: "requested"; waitingFor: TripPlanUserRef }
  | { planId: string; status: "active" };

/** A leaders-only form someone else answered can't be opened to everyone
 *  (form PATCH); Logjam Web's builder says it before Save. */
export const TRIP_PLAN_VISIBILITY_LOCKED_SENTENCE = say`People answered this form for leaders only. Make a new form to share answers with everyone.`;

/** An answer's visibility changed since the form was shown (answer PUT, join). */
export const TRIP_PLAN_VISIBILITY_CHANGED_SENTENCE = say`Who sees the answers to this form has changed. Check it, then answer again.`;

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

const options = (...pairs: [string, string][]): TripPlanQuestionOption[] =>
  pairs.map(([id, label]) => ({ id, label }));

/**
 * Where a leader's form starts. Choosing one fills the builder; the leader
 * can change anything before and after saving. Question ids are stable, so
 * the print summary can find "the phone".
 * Guard: tripPlans.test.ts ("pins the question ids the print summary reads").
 */
export const TRIP_PLAN_FORM_PRESETS: Record<
  TripPlanFormPresetId,
  TripPlanFormCreate
> = {
  gear: {
    title: "Gear to borrow",
    preset: "gear",
    visibleTo: "leaders",
    requiredToJoin: false,
    questions: [
      {
        id: "items",
        kind: "multiChoice",
        label: "What do you need to borrow?",
        help: "Tick only what you don't have.",
        required: false,
        options: options(
          ["harness", "Harness"],
          ["helmet", "Helmet"],
          ["descender", "Descender and carabiner"],
          ["wetsuit", "Wetsuit"],
          ["pack", "Pack and dry bag"],
          ["rope", "Rope (leaders only)"],
        ),
      },
      {
        id: "wetsuitSize",
        kind: "choice",
        label: "Wetsuit size",
        required: false,
        options: options(
          ["xs", "XS"],
          ["s", "S"],
          ["m", "M"],
          ["l", "L"],
          ["xl", "XL"],
          ["xxl", "XXL"],
        ),
      },
      {
        id: "notes",
        kind: "text",
        label: "Anything else?",
        help: "For example, your own descender is a figure 8.",
        required: false,
      },
    ],
  },
  carpool: {
    title: "Carpooling",
    preset: "carpool",
    visibleTo: "members",
    requiredToJoin: false,
    questions: [
      {
        id: "mode",
        kind: "choice",
        label: "How are you getting there?",
        required: true,
        options: options(
          ["seats", "Driving, with seats to offer"],
          ["full", "Driving, car is full"],
          ["lift", "Need a lift"],
          ["own", "Making my own way"],
        ),
      },
      {
        id: "seats",
        kind: "number",
        label: "Seats you can offer",
        required: false,
      },
      {
        id: "from",
        kind: "text",
        label: "Leaving from",
        help: "A suburb is enough.",
        required: false,
      },
      {
        id: "notes",
        kind: "text",
        label: "Anything else?",
        help: "For example, can leave after 7 am.",
        required: false,
      },
    ],
  },
  experience: {
    title: "Experience",
    preset: "experience",
    visibleTo: "leaders",
    requiredToJoin: false,
    questions: [
      {
        id: "trips",
        kind: "choice",
        label: "How many canyon trips have you done?",
        required: true,
        options: options(
          ["none", "None yet"],
          ["few", "1 to 5"],
          ["some", "6 to 20"],
          ["many", "More than 20"],
        ),
      },
      {
        id: "abseil",
        kind: "yesNo",
        label: "Can you set up and do an abseil on your own?",
        required: true,
      },
      {
        id: "swim",
        kind: "yesNo",
        label: "Can you swim 50 m in a pack?",
        required: true,
      },
      {
        id: "notes",
        kind: "longText",
        label: "Anything the leader should know?",
        help: "Fitness, injuries, fear of heights or water.",
        required: false,
      },
    ],
  },
  firstAid: {
    title: "First aid",
    preset: "firstAid",
    visibleTo: "leaders",
    requiredToJoin: false,
    questions: [
      {
        id: "cert",
        kind: "choice",
        label: "Do you hold a current first aid certificate?",
        required: true,
        options: options(
          ["no", "No"],
          ["yes", "Yes"],
          ["remote", "Yes, remote or wilderness first aid"],
        ),
      },
      {
        id: "conditions",
        kind: "longText",
        label: "Medical conditions or allergies",
        help: "Only what the group needs to know in an emergency.",
        required: false,
      },
      {
        id: "medication",
        kind: "text",
        label: "Medication you carry",
        help: "For example, an EpiPen in the lid of your pack.",
        required: false,
      },
    ],
  },
  // Members, and required: whoever is standing there when something goes
  // wrong needs them, leader or not.
  safetyContacts: {
    title: "Safety contacts",
    preset: "safetyContacts",
    visibleTo: "members",
    requiredToJoin: true,
    questions: [
      {
        id: "name",
        kind: "text",
        label: "Contact's name",
        help: "Someone not on the trip who can act if you're overdue.",
        required: true,
      },
      { id: "phone", kind: "phone", label: "Contact's phone", required: true },
      {
        id: "relation",
        kind: "text",
        label: "How do they know you?",
        help: "For example, partner or mum.",
        required: false,
      },
      {
        id: "name2",
        kind: "text",
        label: "Second contact's name",
        required: false,
      },
      {
        id: "phone2",
        kind: "phone",
        label: "Second contact's phone",
        required: false,
      },
    ],
  },
  rules: {
    title: "Trip rules",
    preset: "rules",
    visibleTo: "leaders",
    requiredToJoin: true,
    questions: [
      {
        id: "agree",
        kind: "agree",
        label: "I've read the trip rules and agree to follow them.",
        help: "The rules are in the plan's write-up.",
        required: true,
      },
    ],
  },
};

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

export type TripPlanFormPatch = {
  title?: Cas<string>;
  questions?: Cas<TripPlanQuestion[]>;
  visibleTo?: Cas<TripPlanFormVisibility>;
  requiredToJoin?: Cas<boolean>;
};

/** What the API answers when a compare-and-set finds the row changed. */
export const TRIP_PLAN_CHANGED_SENTENCE = say`Not saved: someone else changed this. Check their change, then save yours again.`;

// ── Validators: one per write shape, run by the API and by both clients ──

/**
 * Why a write is refused: a sentence the person reads (400; 409 when what
 * they saw has changed; 413 for a count over its cap), or a shape only a broken client sends, whose detail
 * never holds what the person wrote (it is logged).
 * Guard: tripPlans.test.ts ("never echoes").
 */
export type TripPlanRefusal =
  | { sentence: UserSentence; status: 400 | 409 | 413 }
  | { malformed: string; status?: 413 };
export type TripPlanParsed<T> = { value: T } | TripPlanRefusal;

class Refused {
  constructor(readonly refusal: TripPlanRefusal) {}
}
function refuse(sentence: UserSentence, status: 400 | 409 | 413 = 400): never {
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

const QUESTION_ID = /^[A-Za-z0-9_-]{1,40}$/;

/** A question id an answer object can hold as its own key: not `__proto__`,
 *  `toString` or anything else a plain object already has. */
function questionId(value: unknown, what: string, seen: Set<string>): string {
  const id = text(value, what);
  if (!QUESTION_ID.test(id) || id in Object.prototype || seen.has(id))
    bad(`${what} must be a unique slug`);
  seen.add(id);
  return id;
}

/** What a stale client is told: the form moved under the person answering. */
export const TRIP_PLAN_FORM_CHANGED_SENTENCE = say`This form changed since you opened it. Check it, then answer again.`;
function stale(): never {
  refuse(TRIP_PLAN_FORM_CHANGED_SENTENCE, 409);
}

function formTitle(value: unknown): string {
  const title = text(value, "title").trim();
  if (!title) refuse(say`Give the form a title.`);
  if (title.length > TRIP_PLAN_FORM_TITLE_MAX_LENGTH)
    refuse(
      say`A form's title can be up to ${TRIP_PLAN_FORM_TITLE_MAX_LENGTH} characters.`,
    );
  return title;
}

function visibility(value: unknown, what: string): TripPlanFormVisibility {
  if (!isTripPlanFormVisibility(value)) bad(`${what} is not a visibility`);
  return value;
}

function flag(value: unknown, what: string): boolean {
  if (typeof value !== "boolean") bad(`${what} must be a boolean`);
  return value;
}

function questionOptions(value: unknown): TripPlanQuestionOption[] {
  if (!Array.isArray(value) || value.length < TRIP_PLAN_MIN_OPTIONS)
    refuse(say`A choice needs at least ${TRIP_PLAN_MIN_OPTIONS} options.`);
  if (value.length > TRIP_PLAN_MAX_OPTIONS)
    refuse(say`A choice can have up to ${TRIP_PLAN_MAX_OPTIONS} options.`, 413);
  const seen = new Set<string>();
  return value.map((raw) => {
    const option = record(raw, "option");
    const id = questionId(option.id, "option.id", seen);
    const label = text(option.label, "option.label").trim();
    if (!label) refuse(say`Every option needs a label.`);
    if (label.length > TRIP_PLAN_OPTION_LABEL_MAX_LENGTH)
      refuse(
        say`An option can be up to ${TRIP_PLAN_OPTION_LABEL_MAX_LENGTH} characters.`,
      );
    return { id, label };
  });
}

function questions(value: unknown): TripPlanQuestion[] {
  if (!Array.isArray(value) || value.length === 0)
    refuse(say`A form needs at least one question.`);
  if (value.length > TRIP_PLAN_MAX_QUESTIONS)
    refuse(
      say`A form can have up to ${TRIP_PLAN_MAX_QUESTIONS} questions.`,
      413,
    );
  const seen = new Set<string>();
  return value.map((raw) => {
    const input = record(raw, "question");
    const id = questionId(input.id, "question.id", seen);
    if (!isTripPlanQuestionKind(input.kind)) bad("question.kind is not a kind");
    const label = text(input.label, "question.label").trim();
    if (!label) refuse(say`Every question needs a label.`);
    if (label.length > TRIP_PLAN_QUESTION_LABEL_MAX_LENGTH)
      refuse(
        say`A question can be up to ${TRIP_PLAN_QUESTION_LABEL_MAX_LENGTH} characters.`,
      );
    const help =
      input.help === undefined || input.help === null
        ? ""
        : text(input.help, "question.help").trim();
    if (help.length > TRIP_PLAN_QUESTION_HELP_MAX_LENGTH)
      refuse(
        say`A question's hint can be up to ${TRIP_PLAN_QUESTION_HELP_MAX_LENGTH} characters.`,
      );
    const question: TripPlanQuestion = {
      id,
      kind: input.kind,
      label,
      required: flag(input.required, "question.required"),
    };
    if (help) question.help = help;
    // Options belong to the two choice kinds; a builder that switched kind
    // may still carry them, and they are dropped rather than refused.
    if (input.kind === "choice" || input.kind === "multiChoice")
      question.options = questionOptions(input.options);
    else if (
      Array.isArray(input.options) &&
      input.options.length > TRIP_PLAN_MAX_OPTIONS
    )
      bad("question.options is over the cap", 413);
    return question;
  });
}

/** POST /plans/:id/forms. */
export function parseTripPlanFormCreate(
  body: unknown,
): TripPlanParsed<Required<TripPlanFormCreate>> {
  return checked(() => {
    const input = record(body, "body");
    const preset = input.preset ?? null;
    if (preset !== null && !isTripPlanFormPresetId(preset))
      bad("preset is not a preset");
    return {
      title: formTitle(input.title),
      preset,
      questions: questions(input.questions),
      visibleTo: visibility(input.visibleTo, "visibleTo"),
      requiredToJoin: flag(input.requiredToJoin, "requiredToJoin"),
    };
  });
}

/** PATCH /plans/:id/forms/:formId. */
export function parseTripPlanFormPatch(
  body: unknown,
): TripPlanParsed<TripPlanFormPatch> {
  return checked(() => {
    const input = record(body, "body");
    const patch: TripPlanFormPatch = {};
    if (input.title !== undefined) {
      const { from, to } = cas(input.title, "title");
      patch.title = { from: text(from, "title.from"), to: formTitle(to) };
    }
    if (input.questions !== undefined) {
      const { from, to } = cas(input.questions, "questions");
      // `from` is what the server served, so it passes the same rules and
      // comes out the same; one that doesn't could never match anyway.
      patch.questions = { from: questions(from), to: questions(to) };
    }
    if (input.visibleTo !== undefined) {
      const { from, to } = cas(input.visibleTo, "visibleTo");
      patch.visibleTo = {
        from: visibility(from, "visibleTo.from"),
        to: visibility(to, "visibleTo.to"),
      };
    }
    if (input.requiredToJoin !== undefined) {
      const { from, to } = cas(input.requiredToJoin, "requiredToJoin");
      patch.requiredToJoin = {
        from: flag(from, "requiredToJoin.from"),
        to: flag(to, "requiredToJoin.to"),
      };
    }
    nothingToChange(patch);
    return patch;
  });
}

/**
 * One answer, normalised; undefined when it says nothing (an empty string, no
 * option ticked, an unticked agree box). A value that doesn't fit the
 * question (a kind or option a leader has changed since the form was opened)
 * is stale, not malformed: an up-to-date client sends it after a leader's edit.
 * A value no kind takes at all (an object, a list of anything but strings)
 * only a broken client sends: malformed.
 */
function answerValue(
  question: TripPlanQuestion,
  value: unknown,
): TripPlanAnswerValue | undefined {
  if (Array.isArray(value)) {
    if (value.length > TRIP_PLAN_MAX_OPTIONS)
      bad("an answer list is over the cap", 413);
    if (value.some((item) => typeof item !== "string"))
      bad("an answer list holds only strings");
  } else if (!["string", "number", "boolean"].includes(typeof value))
    bad("an answer is a string, a number, a boolean or a list of strings");
  const optionIds = new Set(question.options?.map((option) => option.id));
  switch (question.kind) {
    case "text":
    case "phone":
    case "longText": {
      if (typeof value !== "string") stale();
      const answer = value.trim();
      const max =
        question.kind === "longText"
          ? TRIP_PLAN_LONG_TEXT_ANSWER_MAX_LENGTH
          : TRIP_PLAN_TEXT_ANSWER_MAX_LENGTH;
      if (answer.length > max)
        refuse(say`An answer can be up to ${max} characters.`);
      return answer || undefined;
    }
    case "number":
      if (typeof value !== "number") stale();
      if (!Number.isInteger(value) || value < 0)
        refuse(say`Answer with a whole number, 0 or more.`);
      return value;
    case "choice":
      if (typeof value !== "string" || !optionIds.has(value)) stale();
      return value;
    case "multiChoice": {
      if (!Array.isArray(value)) stale();
      if ((value as string[]).some((id) => !optionIds.has(id))) stale();
      const unique = [...new Set(value as string[])];
      return unique.length ? unique : undefined;
    }
    case "yesNo":
      if (typeof value !== "boolean") stale();
      return value;
    case "agree":
      if (typeof value !== "boolean") stale();
      return value || undefined;
  }
}

/**
 * PUT …/answers/me, and the answers a joiner gives. An answer to a question
 * the form no longer has, or that no longer fits one, is a 409: the person
 * answered the form as it was, and is asked to check it.
 */
export function parseTripPlanAnswers(
  formQuestions: readonly TripPlanQuestion[],
  value: unknown,
): TripPlanParsed<TripPlanAnswers> {
  return checked(() => {
    const input = record(value, "answers");
    const byId = new Map(formQuestions.map((q) => [q.id, q]));
    for (const id of Object.keys(input)) if (!byId.has(id)) stale();
    const answers: TripPlanAnswers = {};
    for (const question of formQuestions) {
      const raw = input[question.id];
      const answer =
        raw === undefined || raw === null
          ? undefined
          : answerValue(question, raw);
      if (answer !== undefined) answers[question.id] = answer;
      else if (question.required)
        refuse(say`Answer every question marked required.`);
    }
    return answers;
  });
}

/**
 * A stored answer as the form now reads: values for questions since removed,
 * or that no longer fit a question whose kind or options changed, are left
 * out. Questions keep their answers when a leader edits the form, and a tick
 * list keeps the ticks whose options are still there.
 */
export function currentTripPlanAnswers(
  formQuestions: readonly TripPlanQuestion[],
  stored: unknown,
): TripPlanAnswers {
  if (typeof stored !== "object" || stored === null || Array.isArray(stored))
    return {};
  const answers: TripPlanAnswers = {};
  for (const question of formQuestions) {
    const raw = (stored as Record<string, unknown>)[question.id];
    if (raw === undefined || raw === null) continue;
    const kept =
      question.kind === "multiChoice" && Array.isArray(raw)
        ? raw.filter((id) => question.options?.some((o) => o.id === id))
        : raw;
    const parsed = checked(() => answerValue(question, kept));
    if ("value" in parsed && parsed.value !== undefined)
      answers[question.id] = parsed.value;
  }
  return answers;
}

/**
 * PATCH /plans/:id/items/place/:itemId. Each field sent is compared with
 * what is stored and saves only if it still matches; fields not sent
 * aren't compared. `to` is checked as the place form checks it, against the
 * place's system type.
 */
export type TripPlanPlacePatch = {
  name?: Cas<string>;
  altNames?: Cas<string[]>;
  position?: Cas<{ latitude: number; longitude: number }>;
  elevation?: Cas<number | null>;
  notes?: Cas<string | null>;
  /** One pair per attribute written, each compared on its own; null = no value. */
  fieldValues?: Record<string, Cas<unknown>>;
};

/** PATCH /plans/:id/items/route/:itemId. Geometry and its anchors move together. */
export type TripPlanRoutePatch = {
  name?: Cas<string>;
  color?: Cas<string>;
  geometry?: Cas<{ points: [number, number][]; anchors: number[] | null }>;
};

/** PATCH /plans/:id/items/media/:itemId. */
export type TripPlanFilePatch = { displayName?: Cas<string | null> };

/** POST /plans/:id/items: a copy of one of the caller's own things. */
export type TripPlanItemAdd = {
  kind: TripPlanItemKind;
  id: string;
  /** A place's photos come too. Absent: the caller's remembered preference. */
  copyMedia?: boolean;
};

/** POST /plans/:id/items. */
export function parseTripPlanItemAdd(
  body: unknown,
): TripPlanParsed<TripPlanItemAdd> {
  return checked(() => {
    const input = record(body, "body");
    if (!isTripPlanItemKind(input.kind)) bad("kind is not an item kind");
    const id = text(input.id, "id");
    if (!id) bad("id is empty");
    if (input.copyMedia !== undefined && typeof input.copyMedia !== "boolean")
      bad("copyMedia must be a boolean");
    return {
      kind: input.kind,
      id,
      ...(input.copyMedia !== undefined && { copyMedia: input.copyMedia }),
    };
  });
}

// ── Plan item edits ──
// Each parser checks every pair's shape and caps a `from`'s arrays as its
// `to`'s; what needs the database or the owner's own rules (a place's values
// against its type, a name's length, a colour) is the API's.

function onlyFields(input: Record<string, unknown>, fields: readonly string[]) {
  for (const field of Object.keys(input))
    if (!fields.includes(field)) bad("a field can't be edited");
}

function textOrNull(value: unknown, what: string): string | null {
  return value === null ? null : text(value, what);
}

function numberOrNull(value: unknown, what: string): number | null {
  if (value !== null && typeof value !== "number")
    bad(`${what} must be a number or null`);
  return value;
}

function cappedStrings(value: unknown, what: string, max: number): string[] {
  const list = stringList(value, what);
  if (list.length > max) bad(`${what} is over the cap`, 413);
  return list;
}

function position(value: unknown, what: string) {
  const at = record(value, what);
  if (typeof at.latitude !== "number" || typeof at.longitude !== "number")
    bad(`${what} needs a latitude and a longitude`);
  return { latitude: at.latitude, longitude: at.longitude };
}

/** A route's stored points as a client last saw them: not re-rounded. */
function seenGeometry(value: unknown) {
  const geometry = record(value, "geometry.from");
  if (!Array.isArray(geometry.points)) bad(ROUTE_ERRORS.pointsShape);
  if (geometry.points.length < MIN_ROUTE_POINTS) bad(ROUTE_ERRORS.tooFewPoints);
  if (geometry.points.length > MAX_ROUTE_POINTS)
    bad("geometry.from.points is over the cap", 413);
  for (const point of geometry.points)
    if (
      !Array.isArray(point) ||
      point.length !== 2 ||
      point.some((n) => typeof n !== "number")
    )
      bad(ROUTE_ERRORS.pointsShape);
  const anchors = geometry.anchors ?? null;
  if (anchors !== null) {
    if (
      !Array.isArray(anchors) ||
      anchors.length < 2 ||
      anchors.some((n) => typeof n !== "number")
    )
      bad(ROUTE_ERRORS.anchorsShape);
    if (anchors.length > MAX_ROUTE_POINTS)
      bad("geometry.from.anchors is over the cap", 413);
  }
  return {
    points: geometry.points as [number, number][],
    anchors: anchors as number[] | null,
  };
}

/** PATCH /plans/:id/items/place/:itemId. */
export function parseTripPlanPlacePatch(
  body: unknown,
): TripPlanParsed<TripPlanPlacePatch> {
  return checked(() => {
    const input = record(body, "body");
    onlyFields(input, [
      "name",
      "altNames",
      "position",
      "elevation",
      "notes",
      "fieldValues",
    ]);
    const patch: TripPlanPlacePatch = {};
    if (input.name !== undefined) {
      const { from, to } = cas(input.name, "name");
      patch.name = { from: text(from, "name.from"), to: text(to, "name.to") };
    }
    if (input.altNames !== undefined) {
      const { from, to } = cas(input.altNames, "altNames");
      patch.altNames = {
        from: cappedStrings(from, "altNames.from", PLACE_MAX_ALT_NAMES),
        to: to === null ? [] : stringList(to, "altNames.to"),
      };
    }
    if (input.position !== undefined) {
      const { from, to } = cas(input.position, "position");
      patch.position = {
        from: position(from, "position.from"),
        to: position(to, "position.to"),
      };
    }
    if (input.elevation !== undefined) {
      const { from, to } = cas(input.elevation, "elevation");
      patch.elevation = {
        from: numberOrNull(from, "elevation.from"),
        to: numberOrNull(to, "elevation.to"),
      };
    }
    if (input.notes !== undefined) {
      const { from, to } = cas(input.notes, "notes");
      patch.notes = {
        from: textOrNull(from, "notes.from"),
        to: textOrNull(to, "notes.to"),
      };
    }
    if (input.fieldValues !== undefined) {
      const values = record(input.fieldValues, "fieldValues");
      nothingToChange(values);
      patch.fieldValues = Object.fromEntries(
        Object.entries(values).map(([key, pair]) => [
          key,
          cas(pair, "a field value"),
        ]),
      );
    }
    nothingToChange(patch);
    return patch;
  });
}

/** PATCH /plans/:id/items/route/:itemId. `to`'s points are rounded as stored. */
export function parseTripPlanRoutePatch(
  body: unknown,
): TripPlanParsed<TripPlanRoutePatch> {
  return checked(() => {
    const input = record(body, "body");
    onlyFields(input, ["name", "color", "geometry"]);
    const patch: TripPlanRoutePatch = {};
    if (input.name !== undefined) {
      const { from, to } = cas(input.name, "name");
      patch.name = { from: text(from, "name.from"), to: text(to, "name.to") };
    }
    if (input.color !== undefined) {
      const { from, to } = cas(input.color, "color");
      patch.color = {
        from: text(from, "color.from"),
        to: text(to, "color.to"),
      };
    }
    if (input.geometry !== undefined) {
      const { from, to } = cas(input.geometry, "geometry");
      const next = record(to, "geometry.to");
      if (next.points === undefined) bad(ROUTE_ERRORS.pointsRequired);
      const points = parseRoutePoints(next.points);
      if ("error" in points) bad(points.error);
      const anchors = parseRouteAnchors(next.anchors, points.points.length);
      if ("error" in anchors) bad(anchors.error);
      patch.geometry = {
        from: seenGeometry(from),
        to: { points: points.points, anchors: anchors.anchors },
      };
    }
    nothingToChange(patch);
    return patch;
  });
}

/** PATCH /plans/:id/items/media/:itemId. */
export function parseTripPlanFilePatch(
  body: unknown,
): TripPlanParsed<TripPlanFilePatch> {
  return checked(() => {
    const input = record(body, "body");
    onlyFields(input, ["displayName"]);
    const patch: TripPlanFilePatch = {};
    if (input.displayName !== undefined) {
      const { from, to } = cas(input.displayName, "displayName");
      patch.displayName = {
        from: textOrNull(from, "displayName.from"),
        to: textOrNull(to, "displayName.to"),
      };
    }
    nothingToChange(patch);
    return patch;
  });
}
