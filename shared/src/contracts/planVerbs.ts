// A PLAN'S VERBS, declared once for both clients: the plan's own (its page's
// ⋯), the ways in (Add ▾), and a section's and a form's verbs. A verb the API
// refuses the caller is absent (shared/DESIGN.md §9): by role and archive
// (`requirePlanRole`, `requirePlanWrite`), and Leave by planMembers.ts's
// DELETE checks. A verb that applies but not yet is disabled with its reason
// (§5): Start a trip log before the trip ends. Guard: plans.test.ts ("a
// plan's verbs").
import type { IconIdea } from "../icons.js";
import type { TripPlanRole } from "../tripPlans.js";
import type { ContractPlatform } from "./types.js";

type PlanVerbDeclaration = {
  id: string;
  icon: IconIdea;
  label: string;
  /** The roles that may run it. */
  roles: readonly TripPlanRole[];
  /** Still offered on an archived plan; every other verb goes through
   *  `requirePlanWrite`, which refuses one. */
  whenArchived?: true;
  /** Only this client has it, and `reason` says why. */
  on?: ContractPlatform;
  reason?: string;
  danger?: boolean;
  separated?: boolean;
};

const ANY: readonly TripPlanRole[] = ["leader", "editor", "member"];
const WRITERS: readonly TripPlanRole[] = ["leader", "editor"];
const LEADERS: readonly TripPlanRole[] = ["leader"];

const FORMS_ON_WEB =
  "A form is built once, at a desk, before the trip; Logjam GPS fills forms in and shows answers.";
const PRINT_ON_WEB =
  "A summary is printed or saved as a PDF, which a browser does and a phone's Logjam GPS does not.";

/** The plan's ⋯, in menu order. */
export const PLAN_VERBS = [
  { id: "edit", icon: "edit", label: "Edit name and dates", roles: WRITERS },
  {
    id: "print",
    icon: "print",
    label: "Print a summary",
    roles: ANY,
    whenArchived: true,
    on: "web",
    reason: PRINT_ON_WEB,
  },
  {
    id: "tripLog",
    icon: "trip",
    label: "Start a trip log from this plan",
    roles: ANY,
    whenArchived: true,
  },
  {
    id: "archive",
    icon: "archive",
    label: "Archive",
    roles: LEADERS,
    separated: true,
  },
  {
    id: "unarchive",
    icon: "archive",
    label: "Bring back",
    roles: LEADERS,
    whenArchived: true,
    separated: true,
  },
  {
    id: "leave",
    icon: "leave",
    label: "Leave plan",
    roles: ANY,
    whenArchived: true,
    separated: true,
  },
  {
    id: "delete",
    icon: "delete",
    label: "Delete plan",
    roles: LEADERS,
    whenArchived: true,
    danger: true,
    separated: true,
  },
] as const satisfies readonly PlanVerbDeclaration[];

/** Add ▾ on the plan's page, in menu order. The same words are the buttons
 *  an empty view and a list's end offer. */
export const PLAN_ADD_VERBS = [
  { id: "section", icon: "notes", label: "Add a section", roles: WRITERS },
  { id: "copy", icon: "copy", label: "Add a copy", roles: ANY },
  {
    id: "form",
    icon: "form",
    label: "Add a form",
    roles: LEADERS,
    on: "web",
    reason: FORMS_ON_WEB,
  },
  { id: "invite", icon: "addFriend", label: "Invite people", roles: LEADERS },
] as const satisfies readonly PlanVerbDeclaration[];

/** A section's ⋯. */
export const PLAN_SECTION_VERBS = [
  { id: "edit", icon: "edit", label: "Edit", roles: WRITERS },
  { id: "moveUp", icon: "collapse", label: "Move up", roles: WRITERS },
  { id: "moveDown", icon: "expand", label: "Move down", roles: WRITERS },
  {
    id: "delete",
    icon: "delete",
    label: "Delete",
    roles: WRITERS,
    danger: true,
    separated: true,
  },
] as const satisfies readonly PlanVerbDeclaration[];

/** A form's ⋯. Answering is the form's own button. */
export const PLAN_FORM_VERBS = [
  {
    id: "edit",
    icon: "edit",
    label: "Edit form",
    roles: LEADERS,
    on: "web",
    reason: FORMS_ON_WEB,
  },
  {
    id: "delete",
    icon: "delete",
    label: "Delete form",
    roles: LEADERS,
    danger: true,
    separated: true,
  },
] as const satisfies readonly PlanVerbDeclaration[];

/** Every plan verb list, for the guards that hold them all. */
export const PLAN_VERB_LISTS = [
  PLAN_VERBS,
  PLAN_ADD_VERBS,
  PLAN_SECTION_VERBS,
  PLAN_FORM_VERBS,
] as const;

export type PlanVerbId = (typeof PLAN_VERBS)[number]["id"];
export type PlanAddVerbId = (typeof PLAN_ADD_VERBS)[number]["id"];
export type PlanSectionVerbId = (typeof PLAN_SECTION_VERBS)[number]["id"];
export type PlanFormVerbId = (typeof PLAN_FORM_VERBS)[number]["id"];

export type PlanVerb<Id extends string = string> = {
  id: Id;
  icon: IconIdea;
  label: string;
  danger: boolean;
  separated: boolean;
  /** Offered but not yet runnable, and why (shared/DESIGN.md §5). */
  disabledReason?: string;
};

/** One add verb's words, for a button that offers it outside the menu. */
export function planAddVerbLabel(id: PlanAddVerbId): string {
  return PLAN_ADD_VERBS.find((verb) => verb.id === id)!.label;
}

/** One list's verbs a role may run on one client, on a plan in this state. */
export function planVerbsFor<D extends readonly PlanVerbDeclaration[]>(
  declarations: D,
  platform: ContractPlatform,
  role: TripPlanRole,
  state: { archived: boolean },
): PlanVerb<D[number]["id"]>[] {
  return (declarations as readonly PlanVerbDeclaration[])
    .filter(
      (verb) =>
        (verb.on == null || verb.on === platform) &&
        verb.roles.includes(role) &&
        (!state.archived || verb.whenArchived),
    )
    .map((verb) => ({
      id: verb.id as D[number]["id"],
      icon: verb.icon,
      label: verb.label,
      danger: verb.danger ?? false,
      separated: verb.separated ?? false,
    }));
}

/** Why Start a trip log waits, while the trip is still ahead. */
export const PLAN_TRIP_LOG_WAITS = "After the trip";

/**
 * The plan's ⋯ for one caller: Archive or Bring back by its state; Start a
 * trip log absent while the plan has no dates (there is no trip to wait for)
 * and disabled until the trip is over; Leave absent for the only person in
 * the plan and for its only leader, whom the API refuses (they delete it, or
 * make someone else a leader first).
 */
export function planVerbs(
  platform: ContractPlatform,
  role: TripPlanRole,
  state: {
    archived: boolean;
    dated: boolean;
    over: boolean;
    alone: boolean;
    soleLeader: boolean;
  },
): PlanVerb<PlanVerbId>[] {
  return planVerbsFor(PLAN_VERBS, platform, role, state)
    .filter(
      (verb) =>
        verb.id !== (state.archived ? "archive" : "unarchive") &&
        (verb.id !== "tripLog" || state.dated) &&
        (verb.id !== "leave" || (!state.alone && !state.soleLeader)),
    )
    .map((verb) =>
      verb.id === "tripLog" && !state.over
        ? { ...verb, disabledReason: PLAN_TRIP_LOG_WAITS }
        : verb,
    );
}

// ── Confirms: what goes, what stays, counted ────────────────────────

export type PlanConfirmCopy = {
  confirmTitle: string;
  confirmBody: string;
  confirmLabel: string;
};

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "2 places, 1 way, 340 MB": a zero is left out (shared/DESIGN.md §11). */
export function planCountsLabel(
  counts: { places?: number; ways?: number; maps?: number; files?: number },
  size?: string,
): string {
  return [
    counts.places ? plural(counts.places, "place") : null,
    counts.ways ? plural(counts.ways, "way") : null,
    counts.maps ? plural(counts.maps, "map") : null,
    counts.files ? plural(counts.files, "file") : null,
    size,
  ]
    .filter(Boolean)
    .join(", ");
}

export function planDeleteConfirm(
  name: string,
  counts: { places: number; ways: number; maps: number },
): PlanConfirmCopy {
  const things = planCountsLabel(counts);
  return {
    confirmTitle: `Delete ${name}?`,
    confirmBody: `Its write-up, ${things ? `${things}, ` : ""}forms and everyone's answers go, for everyone. Copies people saved to their own accounts stay.`,
    confirmLabel: "Delete plan",
  };
}

export function planLeaveConfirm(name: string): PlanConfirmCopy {
  return {
    confirmTitle: `Leave ${name}?`,
    confirmBody:
      "You lose access at once. Your answers to its forms go. What you added stays in the plan, and its files keep counting against your storage.",
    confirmLabel: "Leave plan",
  };
}

/** The leave dialog's box, priced: what deleting what the caller added frees. */
export function planLeaveDeleteAddedLabel(
  counts: { places: number; ways: number; maps: number },
  size?: string,
): string {
  return `Also delete what I added (${planCountsLabel(counts, size)})`;
}

export function planSectionDeleteConfirm(title: string): PlanConfirmCopy {
  return {
    confirmTitle: `Delete ${title}?`,
    confirmBody: "Its text goes, for everyone in the plan.",
    confirmLabel: "Delete",
  };
}

/** Counts every answer that goes: everyone else's, and the caller's own,
 *  which a form view carries apart (`myAnswer`). */
export function planFormDeleteConfirm(form: {
  title: string;
  answers: readonly unknown[];
  myAnswer: unknown | null;
}): PlanConfirmCopy {
  const title = form.title;
  const answers = form.answers.length + (form.myAnswer ? 1 : 0);
  return {
    confirmTitle: `Delete ${title}?`,
    confirmBody:
      answers > 0
        ? `Its questions and ${plural(answers, "answer")} go, for everyone in the plan.`
        : "Its questions go, for everyone in the plan.",
    confirmLabel: "Delete form",
  };
}

// ── People ──────────────────────────────────────────────────────────

/** A leader's verbs on someone going, in menu order. */
export const PLAN_MEMBER_VERBS = [
  { id: "makeLeader", icon: "flag", label: "Make a leader", roles: LEADERS },
  { id: "makeEditor", icon: "edit", label: "Make an editor", roles: LEADERS },
  { id: "makeMember", icon: "account", label: "Make a member", roles: LEADERS },
  {
    id: "remove",
    icon: "unshare",
    label: "Remove from plan",
    roles: LEADERS,
    danger: true,
    separated: true,
  },
] as const satisfies readonly PlanVerbDeclaration[];

export type PlanMemberVerbId = (typeof PLAN_MEMBER_VERBS)[number]["id"];

const ROLE_VERB: Record<TripPlanRole, PlanMemberVerbId> = {
  leader: "makeLeader",
  editor: "makeEditor",
  member: "makeMember",
};

/** The verbs a caller has on one person going: none on an archived plan,
 *  and no "Make" for the role they already have. On their own row a leader
 *  may step down while another leader remains, as planMembers.ts's PATCH
 *  allows; they never remove themselves (they leave from the plan's ⋯). */
export function planMemberVerbs(
  callerRole: TripPlanRole,
  target: { role: TripPlanRole; self: boolean },
  state: { archived: boolean; leaders: number },
): PlanVerb<PlanMemberVerbId>[] {
  if (target.self && (target.role !== "leader" || state.leaders < 2)) return [];
  return planVerbsFor(PLAN_MEMBER_VERBS, "web", callerRole, state).filter(
    (verb) =>
      verb.id !== ROLE_VERB[target.role] &&
      !(target.self && verb.id === "remove"),
  );
}

/** The role a "Make …" verb gives. */
export const PLAN_ROLE_OF_VERB: Partial<
  Record<PlanMemberVerbId, TripPlanRole>
> = { makeLeader: "leader", makeEditor: "editor", makeMember: "member" };

export function planRemoveConfirm(
  username: string,
  planName: string,
  files: { count: number; size: string } | null,
): PlanConfirmCopy & { deleteFilesLabel: string | null } {
  const counted = files ? `${plural(files.count, "file")}, ${files.size}` : "";
  return {
    confirmTitle: `Remove ${username} from ${planName}?`,
    confirmBody: `They lose access at once and are told. Their answers to its forms go. What they added stays in the plan.${
      files
        ? ` Their files (${counted}) will count against your storage instead.`
        : ""
    }`,
    confirmLabel: "Remove",
    deleteFilesLabel: files ? `Delete their files instead (${counted})` : null,
  };
}

export function planTurnDownConfirm(username: string): PlanConfirmCopy {
  return {
    confirmTitle: `Turn down ${username}?`,
    confirmBody:
      "They're told their request was turned down. They can ask again with the link.",
    confirmLabel: "Turn down",
  };
}
