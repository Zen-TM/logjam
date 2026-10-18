// A PLAN'S VERBS, declared once for both clients: the plan's own (its page's
// ⋯), the ways in (Add ▾), and the verbs of a section, an item, a form and a
// person in it. Who may run each is the API's rule (design §2): a verb the
// caller's role cannot run is absent, never disabled (shared/DESIGN.md §5).
// Never "Share" anywhere in a plan: what comes in is a copy (ADR 0016).
import type { IconIdea } from "../icons.js";
import type { TripPlanRole } from "../tripPlans.js";
import type { ContractPlatform } from "./types.js";

type PlanVerbDeclaration = {
  id: string;
  icon: IconIdea;
  label: string;
  /** The roles that may run it. */
  roles: readonly TripPlanRole[];
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
    on: "web",
    reason: PRINT_ON_WEB,
  },
  {
    id: "tripLog",
    icon: "trip",
    label: "Start a trip log from this plan",
    roles: ANY,
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
    separated: true,
  },
  {
    id: "leave",
    icon: "leave",
    label: "Leave plan",
    roles: ANY,
    separated: true,
  },
  {
    id: "delete",
    icon: "delete",
    label: "Delete plan",
    roles: LEADERS,
    danger: true,
    separated: true,
  },
] as const satisfies readonly PlanVerbDeclaration[];

/** Add ▾ on the plan's page, in menu order. */
export const PLAN_ADD_VERBS = [
  { id: "section", icon: "notes", label: "Section", roles: WRITERS },
  {
    id: "copy",
    icon: "copy",
    label: "A copy of something of yours",
    roles: ANY,
  },
  {
    id: "form",
    icon: "form",
    label: "Form",
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
};

/** One list's verbs a role may run on one client, in order. */
export function planVerbsFor<D extends readonly PlanVerbDeclaration[]>(
  declarations: D,
  platform: ContractPlatform,
  role: TripPlanRole,
): PlanVerb<D[number]["id"]>[] {
  return (declarations as readonly PlanVerbDeclaration[])
    .filter(
      (verb) =>
        (verb.on == null || verb.on === platform) && verb.roles.includes(role),
    )
    .map((verb) => ({
      id: verb.id as D[number]["id"],
      icon: verb.icon,
      label: verb.label,
      danger: verb.danger ?? false,
      separated: verb.separated ?? false,
    }));
}

/**
 * The plan's ⋯ for one caller: Archive or Bring back by its state, Start a
 * trip log once the trip is over, and every verb but Leave, Bring back and
 * Delete gone from an archived plan (design §9 O-8).
 */
export function planVerbs(
  platform: ContractPlatform,
  role: TripPlanRole,
  state: { archived: boolean; over: boolean },
): PlanVerb<PlanVerbId>[] {
  const stillWorks: readonly PlanVerbId[] = [
    "print",
    "tripLog",
    "unarchive",
    "leave",
    "delete",
  ];
  return planVerbsFor(PLAN_VERBS, platform, role).filter(
    (verb) =>
      (verb.id !== "tripLog" || state.over) &&
      verb.id !== (state.archived ? "archive" : "unarchive") &&
      (!state.archived || stillWorks.includes(verb.id)),
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

export function planFormDeleteConfirm(
  title: string,
  answers: number,
): PlanConfirmCopy {
  return {
    confirmTitle: `Delete ${title}?`,
    confirmBody:
      answers > 0
        ? `Its questions and ${plural(answers, "answer")} go, for everyone in the plan.`
        : "Its questions go, for everyone in the plan.",
    confirmLabel: "Delete form",
  };
}
