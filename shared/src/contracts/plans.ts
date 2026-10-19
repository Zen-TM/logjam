// Plans: the list, a plan's page and joining one. Logjam Web's
// `PlansPanel.tsx`, `PlanDetailPanel.tsx` and `PlanJoinDialog.tsx`; Logjam
// GPS's plans screens. A plan's verbs are `planVerbs.ts`; the wire shapes,
// limits and presets are `../tripPlans.ts`.
import type { IconIdea } from "../icons.js";
import {
  TRIP_PLAN_INVITE_TTL_DAYS,
  TRIP_PLAN_ROLES,
  type DateOnly,
  type TripPlanFormView,
  type TripPlanFormVisibility,
  type TripPlanMemberStatus,
  type TripPlanRole,
  type TripPlanSummary,
} from "../tripPlans.js";
import type { ScreenContract } from "./types.js";

export const TRIP_PLANS_LIST = {
  id: "plans.list",
  question: "What trips am I getting ready for?",
  title: "Plans",
  sections: [
    { key: "hero" },
    // One rail, a true partition: a plan is upcoming, over, or put away.
    { key: "buckets" },
    { key: "list" },
  ],
  copy: {
    add: "New plan",
    buckets: "Plans",
    bucketUpcoming: "Upcoming",
    bucketPast: "Past",
    bucketArchived: "Archived",

    loading: "Loading your plans…",
    loadFailed: "Couldn't load your plans.",
    firstRunTitle: "No plans yet",
    firstRunBody:
      "A plan is where a group gets ready for a trip: the write-up, the places and ways, who's coming and their details.",
    noUpcomingTitle: "Nothing coming up",
    noPastTitle: "No past plans",
    noArchivedTitle: "Nothing archived",

    noDates: "No dates yet",
    pillLeader: "Leader",
    pillEditor: "Editor",
    // Never a pill on a row (a member's own role says nothing); a word where
    // every role is named, such as the invite's role picker and a printout.
    roleMember: "Member",
    pillInvited: "Invited",
    pillWaiting: "Waiting",
    open: "Open",
    decline: "Decline",
    declined: "Invite declined.",
    declineFailed: "Couldn't decline the invite.",
    withdraw: "Withdraw request",
    withdrawn: "Request withdrawn.",
    withdrawFailed: "Couldn't withdraw the request.",

    // The one form for a plan's name, dates and types: New plan, and Edit.
    newTitle: "New plan",
    editTitle: "Edit name and dates",
    name: "Name",
    nameRequired: "Give the plan a name.",
    startDate: "First day",
    endDate: "Last day",
    tripTypes: "Trip types",
    addTripType: "Add a type",
    make: "Make plan",
    save: "Save",
    makeFailed: "Couldn't make the plan.",
    saveFailed: "Couldn't save the plan.",
  },
} as const satisfies ScreenContract;

export type TripPlanBucket = "upcoming" | "past" | "archived";

/** The last day a plan covers: its end, else its start, else none. */
function lastDay(plan: {
  startDate: DateOnly | null;
  endDate: DateOnly | null;
}): DateOnly | null {
  return plan.endDate ?? plan.startDate;
}

/**
 * Where a plan sits on the rail. Upcoming until its last day has passed (the
 * user's own calendar day, `todayDateKey`), a plan with no dates included;
 * archived whatever its dates.
 */
export function tripPlanBucket(
  plan: Pick<TripPlanSummary, "startDate" | "endDate" | "archivedAt">,
  today: DateOnly,
): TripPlanBucket {
  if (plan.archivedAt) return "archived";
  const last = lastDay(plan);
  return last != null && last < today ? "past" : "upcoming";
}

/** True once the trip is over: Start a trip log is offered from then on. */
export function tripPlanIsOver(
  plan: { startDate: DateOnly | null; endDate: DateOnly | null },
  today: DateOnly,
): boolean {
  const last = lastDay(plan);
  return last != null && last < today;
}

/** The first day a plan covers: its start, else its end, else none. */
function firstDay(plan: {
  startDate: DateOnly | null;
  endDate: DateOnly | null;
}): DateOnly | null {
  return plan.startDate ?? plan.endDate;
}

/**
 * A bucket's rows in order: the soonest trip first while it is coming, the
 * newest first once it is over or put away. A plan with no dates sorts last.
 */
export function sortTripPlans<T extends TripPlanSummary>(
  plans: readonly T[],
  bucket: TripPlanBucket,
): T[] {
  const byDate = (a: string | null, b: string | null, dir: 1 | -1) =>
    a === b ? 0 : a == null ? 1 : b == null ? -1 : a < b ? -dir : dir;
  return [...plans].sort((a, b) =>
    bucket === "upcoming"
      ? byDate(firstDay(a), firstDay(b), 1)
      : bucket === "past"
        ? byDate(lastDay(a), lastDay(b), -1)
        : byDate(a.archivedAt, b.archivedAt, -1),
  );
}

/** What an empty bucket says. The first-run state is for no plans at all. */
export function tripPlansEmpty(
  total: number,
  bucket: TripPlanBucket,
): { icon: IconIdea; title: string; body?: string } {
  const copy = TRIP_PLANS_LIST.copy;
  if (total === 0)
    return { icon: "plan", title: copy.firstRunTitle, body: copy.firstRunBody };
  return {
    icon: "plan",
    title:
      bucket === "upcoming"
        ? copy.noUpcomingTitle
        : bucket === "past"
          ? copy.noPastTitle
          : copy.noArchivedTitle,
  };
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
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
];

function dayParts(date: DateOnly) {
  const [year, month, day] = date.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return { year, month: MONTHS[month - 1], day, weekday: WEEKDAYS[weekday] };
}

/**
 * "Sat 8 – Sun 9 Nov", "Fri 31 Oct – Sun 2 Nov", "Sat 8 Nov", "No dates yet".
 * The year shows only when it is not this year's. A date-only value is a
 * calendar day, so no time zone touches it. English words: the copy is.
 */
export function tripPlanDatesLabel(
  startDate: DateOnly | null,
  endDate: DateOnly | null,
  thisYear: number = new Date().getFullYear(),
): string {
  if (startDate == null && endDate == null) return TRIP_PLANS_LIST.copy.noDates;
  if (startDate == null) return `Until ${tripPlanDayLabel(endDate!, thisYear)}`;
  if (endDate == null || endDate === startDate)
    return tripPlanDayLabel(startDate, thisYear);
  const start = dayParts(startDate);
  const end = dayParts(endDate);
  const year = (y: number) => (y === thisYear ? "" : ` ${y}`);
  const startText =
    start.year !== end.year
      ? `${start.weekday} ${start.day} ${start.month}${year(start.year)}`
      : start.month !== end.month
        ? `${start.weekday} ${start.day} ${start.month}`
        : `${start.weekday} ${start.day}`;
  return `${startText} – ${end.weekday} ${end.day} ${end.month}${year(end.year)}`;
}

/** "Sat 8 Nov", or "Sat 8 Nov 2025" in another year. */
export function tripPlanDayLabel(
  date: DateOnly,
  thisYear: number = new Date().getFullYear(),
): string {
  const parts = dayParts(date);
  return `${parts.weekday} ${parts.day} ${parts.month}${parts.year === thisYear ? "" : ` ${parts.year}`}`;
}

/** A list row's status, as a word: an invite and a request outrank a role,
 *  and a member's own role says nothing. */
export function tripPlanRowPill(
  plan: Pick<TripPlanSummary, "status" | "role">,
): string | null {
  const copy = TRIP_PLANS_LIST.copy;
  if (plan.status === "invited") return copy.pillInvited;
  if (plan.status === "requested") return copy.pillWaiting;
  return plan.role === "member" ? null : tripPlanRoleWord(plan.role);
}

/** A role, as a word: "Leader", "Editor", "Member". */
export function tripPlanRoleWord(role: TripPlanRole): string {
  const copy = TRIP_PLANS_LIST.copy;
  return role === "leader"
    ? copy.pillLeader
    : role === "editor"
      ? copy.pillEditor
      : copy.roleMember;
}

/** A list row's subtitle: who a request waits on, else the dates. */
export function tripPlanRowSubtitle(
  plan: TripPlanSummary,
  thisYear?: number,
): string {
  if (plan.status === "requested" && plan.waitingFor)
    return tripPlanWaitingLine(plan.waitingFor.username);
  if (plan.status === "invited" && plan.invitedBy)
    return `${tripPlanDatesLabel(plan.startDate, plan.endDate, thisYear)} · From ${plan.invitedBy.username}`;
  return tripPlanDatesLabel(plan.startDate, plan.endDate, thisYear);
}

export function tripPlanWaitingLine(username: string): string {
  return `Waiting for ${username} to let you in`;
}

/** How many plans wait on the caller: invites they have not answered. Drives
 *  the nav badge. Join requests reach leaders through the Inbox. */
export function tripPlansBadgeCount(
  plans: readonly Pick<TripPlanSummary, "status">[],
): number {
  return plans.filter((plan) => plan.status === "invited").length;
}

/**
 * Logjam GPS's hero: a trip under way ("On now: …"), else the next one, else
 * that nothing is planned. Only plans the caller is in, and only dated ones:
 * an undated plan has no "next". Logjam Web's hero is
 * `TRIP_PLANS_LIST.title`: its chips show the counts.
 */
export function tripPlansHeroTitle(
  plans: readonly TripPlanSummary[],
  today: DateOnly,
  thisYear?: number,
): string {
  if (plans.length === 0) return TRIP_PLANS_LIST.copy.firstRunTitle;
  const coming = sortTripPlans(
    plans.filter(
      (plan) =>
        plan.status === "active" &&
        firstDay(plan) != null &&
        tripPlanBucket(plan, today) === "upcoming",
    ),
    "upcoming",
  );
  const now = coming.find((plan) => firstDay(plan)! <= today);
  if (now) return `On now: ${now.name}`;
  const next = coming[0];
  if (!next) return "Nothing planned";
  return `Next: ${next.name}, ${
    next.startDate
      ? tripPlanDayLabel(next.startDate, thisYear)
      : `until ${tripPlanDayLabel(next.endDate!, thisYear)}`
  }`;
}

// ── A plan's page ───────────────────────────────────────────────────

export const TRIP_PLAN_PAGE = {
  id: "plans.page",
  question: "What do I need to know and do for this trip?",
  sections: [
    // The name, the way back to Plans, Add ▾ and the plan's ⋯.
    { key: "hero" },
    // At most one, by priority (`tripPlanNotice`).
    { key: "notices" },
    // One line: dates · trip types · the caller's role.
    { key: "dates" },
    // One rail over the four views below; only the chosen one is drawn.
    { key: "views" },
    { key: "writeUp" },
    { key: "items" },
    { key: "forms" },
    { key: "people" },
  ],
  copy: {
    back: "Back to plans",
    add: "Add",
    addMenu: "Add to this plan",
    actions: "Plan actions",

    // The map while a plan is open.
    barPrefix: "Plan:",
    showMine: "Show my things",
    backToMap: "Back to my map",

    noticeArchived: "Archived. A leader can bring it back to change it.",
    noticeOver: "This trip is over.",
    roleLeader: "You're a leader",
    roleEditor: "You're an editor",

    views: "Plan view",
    viewWriteUp: "Write-up",
    viewItems: "Map",
    viewForms: "Forms",
    viewPeople: "People",

    loading: "Loading the plan…",
    loadFailed: "Couldn't load the plan.",

    // The write-up.
    writeUpEmpty: "Nothing written yet.",
    sectionTitle: "Section",
    sectionTitleField: "Title",
    sectionBody: "Text",
    sectionSuggestions: "Suggestions",
    sectionSave: "Save",
    sectionSaveFailed: "Couldn't save the section.",
    sectionGone: "This section was deleted.",
    // After the plan changed under an open form: under the field it changed.
    inPlanNowEmpty: "nothing",
    sectionMoveFailed: "Couldn't move the section.",
    sectionDeleteFailed: "Couldn't delete the section.",
    sectionDeleted: "Section deleted.",

    // The things on the map.
    itemsPlaces: "Places",
    itemsWays: "Ways",
    itemsMaps: "Maps",
    itemsEmpty:
      "Nothing here yet. Add a copy of a place, a way or a map of yours.",
    addCopy: "Add a copy",

    // Forms.
    formsEmptyLeader:
      "No forms yet. Start from gear, carpooling, experience, first aid, safety contacts or trip rules.",
    formsEmpty: "No forms yet.",
    pillRequired: "Required to join",
    pillNotAnswered: "Not answered",
    seenByLeaders: "Leaders see answers",
    seenByMembers: "Everyone sees answers",
    answer: "Answer",
    changeAnswer: "Change my answer",
    myAnswer: "Your answer",
    everyonesAnswers: "Answers",
    noAnswerYet: "No answer yet",

    // People.
    peopleAsking: "Asking to join",
    peopleGoing: "Going",
    peopleInvited: "Invited",
    letIn: "Let in",
    turnDown: "Turn down",
    seeAnswers: "See answers",

    archived: "Archived. It's under Archived in Plans.",
    unarchived: "Brought back.",
    archiveFailed: "Couldn't archive the plan.",
    deleted: "Plan deleted.",
    deleteFailed: "Couldn't delete the plan.",
    left: "You left the plan.",
    leaveFailed: "Couldn't leave the plan.",
  },
} as const satisfies ScreenContract;

export type TripPlanPageView = "writeUp" | "items" | "forms" | "people";

/** One plain sentence per form visibility, shown above a form being filled. */
export function tripPlanVisibilityLine(
  visibleTo: TripPlanFormVisibility,
): string {
  return visibleTo === "leaders"
    ? "Only the plan's leaders see your answers."
    : "Everyone in this plan sees your answers, including people who join later.";
}

/** The plan page's one notice, by priority, or none. */
export function tripPlanNotice(args: {
  archived: boolean;
  unansweredRequired: Pick<TripPlanFormView, "id" | "title"> | null;
  over: boolean;
}):
  | { kind: "archived"; icon: IconIdea; text: string }
  | { kind: "answer"; icon: IconIdea; text: string; formId: string }
  | { kind: "over"; icon: IconIdea; text: string }
  | null {
  const copy = TRIP_PLAN_PAGE.copy;
  if (args.archived)
    return { kind: "archived", icon: "archive", text: copy.noticeArchived };
  if (args.unansweredRequired)
    return {
      kind: "answer",
      icon: "form",
      // No audience: the form's visibility line says who sees answers.
      text: `Answer "${args.unansweredRequired.title}".`,
      formId: args.unansweredRequired.id,
    };
  if (args.over) return { kind: "over", icon: "trip", text: copy.noticeOver };
  return null;
}

/** Who's going: active members, leaders first, then editors, then members,
 *  each group in the order they were added. */
export function tripPlanGoing<
  M extends { role: TripPlanRole; status: TripPlanMemberStatus },
>(members: readonly M[]): M[] {
  return members
    .filter((member) => member.status === "active")
    .sort(
      (a, b) =>
        TRIP_PLAN_ROLES.indexOf(a.role) - TRIP_PLAN_ROLES.indexOf(b.role),
    );
}

/** Whether the API would refuse the caller's Leave: the only person in the
 *  plan deletes it instead; its only leader makes someone else one first. */
export function tripPlanLeaveState(plan: {
  myRole: TripPlanRole;
  members: readonly { role: TripPlanRole; status: TripPlanMemberStatus }[];
}): { alone: boolean; soleLeader: boolean } {
  const going = plan.members.filter((member) => member.status === "active");
  const leaders = going.filter((member) => member.role === "leader").length;
  return {
    alone: going.length <= 1,
    soleLeader: plan.myRole === "leader" && leaders <= 1,
  };
}

/** "Added by tom", or nothing once the adder's account is gone. */
export function tripPlanAddedByLine(
  addedBy: { username: string } | null,
): string | undefined {
  return addedBy ? `Added by ${addedBy.username}` : undefined;
}

/** The dates line: dates · trip types · the caller's role (a member's says nothing). */
export function tripPlanDatesLine(
  plan: {
    startDate: DateOnly | null;
    endDate: DateOnly | null;
    tripTypes: readonly string[];
  },
  role: TripPlanRole,
  typeLabel: (type: string) => string,
  thisYear?: number,
): string {
  const copy = TRIP_PLAN_PAGE.copy;
  return [
    tripPlanDatesLabel(plan.startDate, plan.endDate, thisYear),
    plan.tripTypes.length > 0 ? plan.tripTypes.map(typeLabel).join(", ") : null,
    role === "leader"
      ? copy.roleLeader
      : role === "editor"
        ? copy.roleEditor
        : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** One press away in the write-up's add dialog: no section is required. */
export const TRIP_PLAN_SECTION_SUGGESTIONS = [
  "Access",
  "Gear",
  "Transport",
  "Exit",
  "Emergency",
] as const;

// ── Joining ─────────────────────────────────────────────────────────

export const TRIP_PLAN_JOIN = {
  id: "plans.join",
  question: "Do I want to join this trip, and what do they need from me?",
  sections: [
    // The name, the dates and who leads it.
    { key: "hero" },
    // The forms a joiner answers first, each with its visibility line.
    { key: "forms" },
  ],
  copy: {
    leader: "Leader:",
    invitedBy: "Invited by",
    answerToAsk: "Answer these to ask to join.",
    answerToJoin: "Answer these to join.",
    askToJoin: "Ask to join",
    join: "Join",
    decline: "Decline",
    joinFailed: "Couldn't join the plan.",
    linkFailed: "This invite link no longer works. Ask for a new one.",
    signIn: "A trip invite is waiting. Create an account or sign in to see it.",
  },
} as const satisfies ScreenContract;

/** A leader inviting people: by username, or by a link, which they can turn
 *  off. A step inside the plan page's People. */
export const TRIP_PLAN_INVITE = {
  id: "plans.invite",
  title: "Invite people",
  question: "Who else should come, and how do they get in?",
  sections: [
    // The username search and the role they will get.
    { key: "search" },
    // Or a link: the hint, Copy and Share, then the live links.
    { key: "link" },
  ],
  copy: {
    searchField: "Search by username",
    role: "Role",
    inviteSend: "Invite",
    invited: "Invited.",
    inviteFailed: "Couldn't invite them.",
    linkHint: `Or send a link. Anyone with the link can ask to join. A leader lets each person in. It works for ${TRIP_PLAN_INVITE_TTL_DAYS} days.`,
    linkCopy: "Copy invite link",
    linkShare: "Share invite link",
    linkCopied: "Invite link copied.",
    linkMakeFailed: "Couldn't make an invite link.",
    linkCopyFailed: "Couldn't copy the invite link.",
    linkRevoke: "Turn off",
    linkRevoked: "That link no longer works.",
    linkRevokeFailed: "Couldn't turn off the link.",
    linksLive: "Links that work",
    inPlan: "In this plan",
    searchFailed: "Couldn't search users.",
  },
} as const satisfies ScreenContract;

/** What an open edit form says under a field the plan changed meanwhile. */
export function tripPlanInPlanNow(words: string): string {
  return `In the plan now: ${words || TRIP_PLAN_PAGE.copy.inPlanNowEmpty}`;
}

/** The toast after asking to join through a link. */
export function tripPlanAskedMessage(leader: string): string {
  return `Asked to join. ${leader} will let you in.`;
}

/** What goes in the message a plan link is sent with. */
export function tripPlanInviteMessage(planName: string, url: string): string {
  return `Join ${planName} on Logjam: ${url}`;
}

/**
 * What "Start a trip log from this plan" puts in the real trip form: the
 * first day, the name, the types, and the write-up as notes ("Title", a blank
 * line, the text, for each section that has any). The places are picked in a step of their
 * own, since each is saved as the caller's copy first.
 */
export function tripPlanTripLogPrefill(plan: {
  name: string;
  startDate: DateOnly | null;
  endDate: DateOnly | null;
  tripTypes: readonly string[];
  sections: readonly { title: string; body: string }[];
}): {
  date: DateOnly | null;
  displayName: string;
  types: string[];
  notes: string;
} {
  return {
    date: firstDay(plan),
    displayName: plan.name,
    types: [...plan.tripTypes],
    // An empty section (every plan starts with Overview) says nothing.
    notes: plan.sections
      .filter((section) => section.body)
      .map((section) => `${section.title}\n\n${section.body}`)
      .join("\n\n"),
  };
}

/**
 * What a plan holds, as its delete confirm and its On the map view count it:
 * a way is a route or a standalone file (an import or a recording).
 */
export function tripPlanCounts(plan: {
  places: readonly unknown[];
  routes: readonly unknown[];
  files: readonly unknown[];
  geoPdfs: readonly unknown[];
}): { places: number; ways: number; maps: number } {
  return {
    places: plan.places.length,
    ways: plan.routes.length + plan.files.length,
    maps: plan.geoPdfs.length,
  };
}
