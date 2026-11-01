// Plans: the list, a plan's page and joining one. Logjam Web's
// `PlansPanel.tsx`, `PlanDetailPanel.tsx` and `PlanJoinDialog.tsx`; Logjam
// GPS's plans screens. A plan's verbs are `planVerbs.ts`; the wire shapes,
// limits and presets are `../tripPlans.ts`.
import type { IconIdea } from "../icons.js";
import {
  TRIP_PLAN_INVITE_TTL_DAYS,
  TRIP_PLAN_ROLES,
  TRIP_PLAN_VISIBILITY_LOCKED_SENTENCE,
  type DateOnly,
  type TripPlanAnswerValue,
  type TripPlanAnswerView,
  type TripPlanQuestion,
  type TripPlanQuestionKind,
  type TripPlanFormPresetId,
  type TripPlanFormView,
  type TripPlanFormVisibility,
  type TripPlanItemKind,
  type TripPlanInvitedPreview,
  type TripPlanMemberStatus,
  type TripPlanRole,
  type TripPlanSummary,
  type TripPlanUserRef,
  type TripPlanView,
} from "../tripPlans.js";
import type { ScreenContract } from "./types.js";
import { formatBytes } from "../format.js";
import { mediaSkippedSentence } from "../friendShareRows.js";
import { todayDateKey } from "../logbook.js";

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
    // The hero's line and Logjam GPS's More row, when nothing is coming up.
    nothingPlanned: "Nothing planned",

    noDates: "No dates yet",
    pillLeader: "Leader",
    pillEditor: "Editor",
    // Never a pill on a row (a member's own role says nothing); a word where
    // every role is named, such as the invite's role picker and a printout.
    // Guard: plans.test.ts (a member's row says nothing).
    roleMember: "Member",
    pillInvited: "Invited",
    pillWaiting: "Waiting",
    open: "Open",
    decline: "Decline",
    declined: "Invite declined.",
    declineFailed: "Couldn't decline the invite.",
    withdrawn: "Request withdrawn.",
    withdrawFailed: "Couldn't withdraw the request.",

    // The one form for a plan's name, dates and types: New plan, and Edit.
    newTitle: "New plan",
    editTitle: "Edit name and dates",
    name: "Name",
    nameRequired: "Give the plan a name.",
    tripTypes: "Trip types",
    addTripType: "Add a type",
    make: "Make plan",
    save: "Save",
    makeFailed: "Couldn't make the plan.",
    saveFailed: "Couldn't save the plan.",

    plansActions: "Plans actions",
    selectAllPlans: "Select all plans",
    archiveSelected: "Archive the selected plans",
    unarchiveSelected: "Bring back the selected plans",
  },
} as const satisfies ScreenContract;

/** A plan card's ⋯ label. */
export const tripPlanCardActionsLabel = (name: string) => `Actions for ${name}`;

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

/** True once the plan has a day: Start a trip log is offered from then on. */
export function tripPlanIsDated(plan: {
  startDate: DateOnly | null;
  endDate: DateOnly | null;
}): boolean {
  return firstDay(plan) != null;
}

/** True once the trip is over: Start a trip log enables from then on. */
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
  if (!next) return TRIP_PLANS_LIST.copy.nothingPlanned;
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
    // Above On the map's rows, while that view is chosen and has a place or
    // a way: the map in plan mode, the plan's items only.
    {
      key: "showOnMap",
      on: "gps",
      reason:
        "On Logjam Web the map sits beside the plan's page and already shows only the plan's items while it is open. On Logjam GPS the page covers the map.",
    },
    // On Logjam GPS a place row, and its pin in plan mode, opens a read-only
    // sheet; Logjam Web fits its map to the place instead, the map beside
    // the page.
    { key: "items" },
    { key: "forms" },
    { key: "people" },
  ],
  copy: {
    back: "Back to plans",
    showOnMap: "Show on map",
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

    // The one-calendar date range field.
    datesField: "Dates",
    datesNone: "No dates yet",
    datesPrevMonth: "Previous month",
    datesNextMonth: "Next month",
    datesJustThisDay: "Just this day",
    datesClear: "Clear dates",

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
    sectionTitlePlaceholder: "For example, Overview, Gear or Access",
    sectionSave: "Save",
    sectionSaveFailed: "Couldn't save the section.",
    sectionGone: "This section was deleted.",
    // After the plan changed under an open form: under the field it changed.
    inPlanNow: "In the plan now:",
    inPlanNowEmpty: "nothing",
    sectionMoveFailed: "Couldn't move the section.",
    sectionDeleteFailed: "Couldn't delete the section.",
    sectionDeleted: "Section deleted.",

    // The things on the map.
    itemsPlaces: "Places",
    itemsWays: "Ways",
    itemsEmpty: "Nothing here yet. Add a place or way of yours.",
    addCopyLine:
      "Everyone in this plan, including people who join later, can see and copy what you add to it.",
    searchByName: "Search by name",
    searchNoMatch: "Nothing matches that name.",
    photosCountToo: "Photos count too.",
    addCopyFailed: "Couldn't add that.",
    nothingToAdd: "Nothing of yours here yet.",
    nothingTicked: "Tick something to add.",
    saveCopyLine:
      "The copy is yours. Changes to it stay with you, and changes in the plan don't reach it.",
    saveCopyFailed: "Couldn't save a copy.",
    itemDeleteFailed: "Couldn't delete that.",
    itemDeleted: "Deleted from the plan.",
    itemEdit: "Edit",
    itemName: "Name",
    itemNotes: "Notes",
    itemSaveFailed: "Couldn't save that.",
    itemGone: "This was deleted from the plan.",
    itemOtherNames: "Other names",
    itemOtherNamesHint: "Separate them with commas.",
    itemLatitude: "Latitude",
    itemLongitude: "Longitude",
    itemElevation: "Elevation (m)",
    itemAttributes: "Attributes",
    saveCopyPhotos: "Bring its photos",
    drawRoute: "Draw a route",
    itemDownloadHint: "Click to download",
    placeTypeFallback: "Place",
    placeCopyFailed: "Couldn't copy the coordinates.",
    tripLogPlaces: "Places on this trip",
    tripLogNext: "Next",

    // Forms.
    formsEmptyLeader:
      "No forms yet. Start from gear, carpooling, experience, first aid, safety contacts or trip rules.",
    formsEmpty: "No forms yet.",
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
    roleFailed: "Couldn't change their role.",
    letInFailed: "Couldn't let them in.",
    turnDownFailed: "Couldn't turn them down.",
    turnedDown: "Request turned down.",
    removeFailed: "Couldn't remove them.",
    cancelInvite: "Cancel invite",
    cancelInviteFailed: "Couldn't cancel the invite.",
    inviteCancelled: "Invite cancelled.",

    archived: "Archived. It's under Archived in Plans.",
    unarchived: "Brought back.",
    archiveFailed: "Couldn't archive the plan.",
    deleted: "Plan deleted.",
    deleteFailed: "Couldn't delete the plan.",
    left: "You left the plan.",
    leaveFailed: "Couldn't leave the plan.",
  },
} as const satisfies ScreenContract;

/** The place dialog's copy-the-coordinates button, named for its place
 *  (`TRIP_PLAN_PAGE.copy.placeCopyFailed` is its failure). */
export function tripPlanCopyCoordinatesLabel(name: string): string {
  return `Copy the coordinates of ${name}`;
}

export type TripPlanPageView = "writeUp" | "items" | "forms" | "people";

/** The presets Logjam Web's print summary carries, when everyone in the
 *  plan sees their answers, and the questions of each it prints, in order.
 *  The one list the summary prints from and `tripPlanVisibilityLine` warns
 *  from. Guard: plans.test.ts (the printed columns). */
export const TRIP_PLAN_PRINTED_COLUMNS: Partial<
  Record<TripPlanFormPresetId, readonly string[]>
> = {
  carpool: ["mode", "seats", "from"],
  safetyContacts: ["name", "phone", "name2", "phone2"],
};
export const TRIP_PLAN_PRINTED_PRESETS = Object.keys(
  TRIP_PLAN_PRINTED_COLUMNS,
) as TripPlanFormPresetId[];

/** Who sees the answers, shown above a form being filled: one plain
 *  sentence, and a second for a form a member may print. */
export function tripPlanVisibilityLine(
  visibleTo: TripPlanFormVisibility,
  preset: TripPlanFormPresetId | null = null,
): string {
  if (visibleTo === "leaders")
    return "Only the plan's leaders see your answers.";
  const line =
    "Everyone in this plan sees your answers, including people who join later.";
  return preset && TRIP_PLAN_PRINTED_PRESETS.includes(preset)
    ? `${line} Members may print them for someone not on the trip, such as a parent.`
    : line;
}

/** The plan page's one notice, by priority, or none. */
export function tripPlanNotice(args: {
  archived: boolean;
  over: boolean;
}):
  | { kind: "archived"; icon: IconIdea; text: string }
  | { kind: "over"; icon: IconIdea; text: string }
  | null {
  const copy = TRIP_PLAN_PAGE.copy;
  if (args.archived)
    return { kind: "archived", icon: "archive", text: copy.noticeArchived };
  if (args.over) return { kind: "over", icon: "trip", text: copy.noticeOver };
  return null;
}

/** The map draws the user's own things: no plan on it, or Show my things
 *  asked for beside one. Each client turns Show my things off as a plan
 *  opens. */
export function planShowsMine(planShown: boolean, showMine: boolean): boolean {
  return !planShown || showMine;
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

// ── Joining ─────────────────────────────────────────────────────────

export const TRIP_PLAN_JOIN = {
  id: "plans.join",
  question: "Do I want to join this trip, and what do they need from me?",
  sections: [
    // The name, the dates and who leads it.
    { key: "hero" },
  ],
  copy: {
    leader: "Leader:",
    invitedBy: "Invited by",
    askToJoin: "Ask to join",
    join: "Join",
    decline: "Decline",
    joinFailed: "Couldn't join the plan.",
    linkFailed: "This invite link no longer works. Ask for a new one.",
    signIn: "A trip invite is waiting. Create an account or sign in to see it.",
  },
} as const satisfies ScreenContract;

/**
 * A plan someone is invited to by username, before they join
 * (GET /plans/:id/preview): what they would join and what it asks first,
 * with Join and Decline. Its words are the join dialog's and the plan page's.
 */
export const TRIP_PLAN_PREVIEW = {
  id: "plans.preview",
  question: "What would I be joining, and what does it ask first?",
  sections: [
    // The name, then "dates · Invited by …" (`tripPlanInvitedLine`).
    { key: "hero" },
    // "Invited", with Join and Decline.
    { key: "notice" },
    { key: "writeUp" },
    // Who's going. People are headed only beside a write-up
    // (`tripPlanPreviewHeaded`, shared/DESIGN.md §2).
    { key: "people" },
  ],
  // The join dialog's and the plan page's words, not a second copy.
  copy: {
    invited: TRIP_PLANS_LIST.copy.pillInvited,
    join: TRIP_PLAN_JOIN.copy.join,
    decline: TRIP_PLAN_JOIN.copy.decline,
    declined: TRIP_PLANS_LIST.copy.declined,
    declineFailed: TRIP_PLANS_LIST.copy.declineFailed,
    people: TRIP_PLAN_PAGE.copy.peopleGoing,
    loading: TRIP_PLAN_PAGE.copy.loading,
    loadFailed: TRIP_PLAN_PAGE.copy.loadFailed,
  },
} as const satisfies ScreenContract;

/** The preview's line under its name: its dates, and who invited. */
export function tripPlanInvitedLine(
  preview: Pick<TripPlanInvitedPreview, "startDate" | "endDate" | "invitedBy">,
  thisYear: number = new Date().getFullYear(),
): string {
  return [
    tripPlanDatesLabel(preview.startDate, preview.endDate, thisYear),
    preview.invitedBy &&
      `${TRIP_PLAN_JOIN.copy.invitedBy} ${preview.invitedBy.username}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Whether the preview's people take a heading: only beside a write-up to
 *  divide them from. */
export function tripPlanPreviewHeaded(
  preview: Pick<TripPlanInvitedPreview, "sections">,
): boolean {
  return preview.sections.length > 0;
}

/** The join dialog's title. */
export function tripPlanJoinTitle(planName: string): string {
  return `Join ${planName}`;
}

/** Whether a plan opens as an invite's preview: as its opener said, unless
 *  the plans list since has the reader in it (they joined meanwhile). Not
 *  from the list alone: an invite that arrived while the list was open is
 *  not in it yet, and the member's page 404s for someone invited. */
export function opensPreview(
  invited: boolean,
  listed: TripPlanMemberStatus | undefined,
): boolean {
  return invited && listed !== "active";
}

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
    back: "Back to people",
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

/** A live invite link's row: "Made Mon 19 Oct, works until Mon 26 Oct",
 *  each the day it is where the reader is. */
export function tripPlanInviteLinkLine(
  link: { createdAt: string; expiresAt: string },
  thisYear?: number,
): string {
  const day = (instant: string) =>
    tripPlanDayLabel(todayDateKey(new Date(instant)), thisYear);
  return `Made ${day(link.createdAt)}, works until ${day(link.expiresAt)}`;
}

/** A person found in Invite people's search, as the plan has them now. */
export function tripPlanInviteePill(
  status: TripPlanMemberStatus | undefined,
): string | null {
  if (status === "active") return TRIP_PLAN_INVITE.copy.inPlan;
  if (status === "invited") return TRIP_PLAN_PAGE.copy.peopleInvited;
  if (status === "requested") return TRIP_PLAN_PAGE.copy.peopleAsking;
  return null;
}

/** What an open edit form says under a field the plan changed meanwhile. */
export function tripPlanInPlanNow(words: string): string {
  const copy = TRIP_PLAN_PAGE.copy;
  return `${copy.inPlanNow} ${words || copy.inPlanNowEmpty}`;
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
    // An empty section says nothing.
    notes: plan.sections
      .filter((section) => section.body)
      .map((section) => `${section.title}\n\n${section.body}`)
      .join("\n\n"),
  };
}

/** What the trip form opens with, from a plan. */
export type TripPlanTripLogPrefill = ReturnType<typeof tripPlanTripLogPrefill>;

// ── Forms ───────────────────────────────────────────────────────────

export const TRIP_PLAN_FORMS = {
  id: "plans.form",
  question: "What does this form ask, and what did people answer?",
  sections: [
    // The title, back to the plan, the form's ⋯.
    { key: "hero" },
    // `tripPlanVisibilityLine`, always before any answer.
    { key: "visibility" },
    { key: "mine" },
    // Everyone's answers, when the caller may see them: a row per member,
    // then, for a leader, the answers of those asking to join, marked so.
    {
      key: "table",
      on: "web",
      reason:
        "A table a column per question needs a desk's width; Logjam GPS lists each person's answers under their name.",
    },
    {
      key: "list",
      on: "gps",
      reason:
        "A phone has no room for a column per question, so each person's answers stack under their name.",
    },
  ],
  copy: {
    back: "Back to the plan",
    actions: "Form actions",
    mine: "Your answer",
    answers: "Answers",
    answer: "Answer",
    change: "Change my answer",
    noAnswer: "You haven't answered yet.",
    noAnswerYet: "No answer yet",
    member: "Member",
    asking: "Asking to join",
    save: "Send",
    saveFailed: "Couldn't send your answer.",
    saved: "Answer sent.",
    deleteFailed: "Couldn't delete the form.",
    deleted: "Form deleted.",

    // The builder, on both clients (`PLAN_FORM_VERBS`).
    newTitle: "New form",
    editTitle: "Edit form",
    startFrom: "Start from",
    blank: "A blank form",
    title: "Title",
    visibleTo: "Who sees the answers",
    visibleToLeaders: "Leaders",
    visibleToMembers: "Everyone in the plan",
    // The API's refusal, said before Save.
    visibleToLocked: TRIP_PLAN_VISIBILITY_LOCKED_SENTENCE,
    questions: "Questions",
    // After a 409, over questions another leader saved meanwhile.
    questionsChanged:
      "Another leader changed these questions since you opened the form. Saving keeps yours.",
    questionLabel: "Question",
    questionKind: "Kind",
    questionHelp: "Hint",
    questionRequired: "Required",
    options: "Options",
    optionLabel: "Option",
    addOption: "Add an option",
    removeOption: "Remove option",
    addQuestion: "Add a question",
    removeQuestion: "Remove question",
    moveUp: "Move up",
    moveDown: "Move down",
    add: "Add form",
    saveForm: "Save",
    formSaveFailed: "Couldn't save the form.",
    // The chooser a new form starts from.
    chooseTemplates: "Templates",
    chooseMine: "From your other plans",
    chooseBlankHint: "Write your own questions.",
    chooseMineLoading: "Loading your forms…",
    chooseMineFailed: "Couldn't load your forms from other plans.",
    chooseMineEmpty: "Forms you make in other plans you lead show up here.",
    formSaved: "Form saved.",
    yes: "Yes",
    no: "No",
    agreed: "Agreed",
  },
} as const satisfies ScreenContract;

/** One line under each template in the new-form chooser. */
export const TRIP_PLAN_FORM_PRESET_BLURBS: Record<
  TripPlanFormPresetId,
  string
> = {
  gear: "Who needs to borrow what, and wetsuit sizes.",
  carpool: "Who can drive, who needs a lift, and from where.",
  experience: "How much canyoning and abseiling people have done.",
  firstAid: "First aid training and what people carry.",
  safetyContacts:
    "Someone to call, and medical details people choose to share.",
  rules: "The trip's ground rules, for each person to agree to.",
};

/** Each question kind's name in the builder. */
export const TRIP_PLAN_QUESTION_KIND_LABELS: Record<
  TripPlanQuestionKind,
  string
> = {
  text: "Short answer",
  longText: "Paragraph",
  phone: "Phone number",
  number: "Number",
  choice: "One from a list",
  multiChoice: "Tick list",
  yesNo: "Yes or no",
  agree: "A box to tick",
};

/** An answer as words, for a table, a list or the print summary. Blank when
 *  there is none, so a table cell can say so in its own words. */
export function tripPlanAnswerText(
  question: TripPlanQuestion,
  value: TripPlanAnswerValue | undefined,
): string {
  if (value === undefined) return "";
  const copy = TRIP_PLAN_FORMS.copy;
  const label = (id: string) =>
    question.options?.find((option) => option.id === id)?.label ?? "";
  switch (question.kind) {
    case "choice":
      return label(String(value));
    case "multiChoice":
      return (Array.isArray(value) ? value : []).map(label).join(", ");
    case "yesNo":
      return value ? copy.yes : copy.no;
    case "agree":
      return value ? copy.agreed : "";
    default:
      return String(value);
  }
}

/**
 * A form's answers as a reader sees them: everyone going, each with their
 * answer or none, those without last; then, for a leader (the API serves no
 * one else theirs), those asking to join who answered, marked apart. Anyone
 * else with a plan row (an invitee) is left out.
 */
export function tripPlanAnswerRows(
  form: Pick<TripPlanFormView, "answers" | "myAnswer">,
  members: readonly {
    user: TripPlanUserRef;
    status: TripPlanMemberStatus;
  }[],
): {
  going: { user: TripPlanUserRef; answer?: TripPlanAnswerView }[];
  asking: { user: TripPlanUserRef; answer: TripPlanAnswerView }[];
} {
  const answerBy = new Map(
    [...form.answers, ...(form.myAnswer ? [form.myAnswer] : [])].map(
      (answer) => [answer.user.id, answer],
    ),
  );
  return {
    going: members
      .filter((member) => member.status === "active")
      .map((member) => ({
        user: member.user,
        answer: answerBy.get(member.user.id),
      }))
      .sort((a, b) => Number(!a.answer) - Number(!b.answer)),
    asking: members
      .filter((member) => member.status === "requested")
      .flatMap((member) => {
        const answer = answerBy.get(member.user.id);
        return answer ? [{ user: member.user, answer }] : [];
      }),
  };
}

/**
 * The picks a choice or yes/no question offers, as the shared draft holds
 * them: an option's id, or "true"/"false" (`answersFromDraft` turns only
 * those into a boolean). An optional one starts with "—", so a pick can be
 * taken back (shared/DESIGN.md §10).
 */
export function tripPlanQuestionChoices(
  question: Pick<TripPlanQuestion, "kind" | "required" | "options">,
): { value: string; label: string }[] {
  const copy = TRIP_PLAN_FORMS.copy;
  return [
    ...(question.required ? [] : [{ value: "", label: "—" }]),
    ...(question.kind === "yesNo"
      ? [
          { value: "true", label: copy.yes },
          { value: "false", label: copy.no },
        ]
      : (question.options ?? []).map((option) => ({
          value: option.id,
          label: option.label,
        }))),
  ];
}

/** Whether the caller sees other people's answers to a form: leaders always,
 *  everyone else when the form says so. The API's `formView` filters with it.
 *  Guard: api/src/__tests__/planForms.test.ts ("leaders-only answers reach
 *  the leaders and their author, no one else"). */
export function tripPlanSeesAnswers(
  role: TripPlanRole,
  visibleTo: TripPlanFormVisibility,
): boolean {
  return role === "leader" || visibleTo === "members";
}

/** How many days before a trip's first day the forms nudge turns warning. */
export const TRIP_PLAN_FORMS_URGENT_DAYS = 7;

/** "1 form to answer", "3 forms to answer": the plan page's card and the
 *  plans list's card say it the same way. Empty for none. */
export function tripPlanFormsToAnswerLine(count: number): string {
  if (count <= 0) return "";
  return count === 1 ? "1 form to answer" : `${count} forms to answer`;
}

const DAY_MS = 86_400_000;

/** The nudge turns urgent when forms are waiting and the trip starts within
 *  TRIP_PLAN_FORMS_URGENT_DAYS: one rule for the plan page and the list card. */
export function tripPlanFormsUrgent(
  count: number,
  plan: { startDate: DateOnly | null; endDate: DateOnly | null },
  today: DateOnly,
): boolean {
  const first = firstDay(plan);
  return (
    count > 0 &&
    first != null &&
    (Date.parse(`${first}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) /
      DAY_MS <=
      TRIP_PLAN_FORMS_URGENT_DAYS
  );
}

/**
 * The forms the caller hasn't answered, in the plan's order, and whether the
 * nudge is urgent: the trip's first day is within 7 days (or has come), by
 * date key. Nothing to answer once the trip is over or the plan archived.
 * Guard: plans.test.ts ("forms to answer").
 */
export function tripPlanFormsToAnswer(
  plan: Pick<TripPlanView, "forms" | "startDate" | "endDate" | "archivedAt">,
  today: DateOnly,
): { forms: Pick<TripPlanFormView, "id" | "title">[]; urgent: boolean } {
  const forms =
    plan.archivedAt || tripPlanIsOver(plan, today)
      ? []
      : plan.forms
          .filter((form) => form.myAnswer == null)
          .map(({ id, title }) => ({ id, title }));
  const urgent = tripPlanFormsUrgent(forms.length, plan, today);
  return { forms, urgent };
}

/**
 * A leader's tally for one form: how many active members have answered and
 * who hasn't. A leader's view carries every answer to every form (both
 * visibilities) and every member, so this needs nothing more; null for
 * anyone else, whose view does not.
 * Guard: plans.test.ts ("form tally").
 */
export function tripPlanFormTally(
  plan: Pick<TripPlanView, "members" | "myRole">,
  form: Pick<TripPlanFormView, "myAnswer" | "answers">,
  me: string,
): { answered: number; total: number; missing: TripPlanUserRef[] } | null {
  if (plan.myRole !== "leader") return null;
  const answered = new Set(form.answers.map((answer) => answer.user.id));
  if (form.myAnswer) answered.add(me);
  const active = plan.members.filter((member) => member.status === "active");
  const missing = active
    .filter((member) => !answered.has(member.user.id))
    .map((member) => member.user);
  return {
    answered: active.length - missing.length,
    total: active.length,
    missing,
  };
}

/** "3 of 5 answered", and "Not answered yet: bob, carol" when anyone is left. */
export function tripPlanFormTallyLines(tally: {
  answered: number;
  total: number;
  missing: readonly TripPlanUserRef[];
}): string[] {
  return [
    `${tally.answered} of ${tally.total} answered`,
    ...(tally.missing.length > 0
      ? [
          `Not answered yet: ${tally.missing.map((user) => user.username).join(", ")}`,
        ]
      : []),
  ];
}

/**
 * What a selection on the plans list offers. A selection mixes roles, and
 * one button acts on each plan as its role allows: the plans you lead are
 * deleted, the rest are left. Archive is offered only when every plan is led,
 * so it never skips one. Guard: plans.test.ts ("what a bulk selection offers").
 */
export function tripPlanBulkOffers<P extends { role: TripPlanRole }>(
  plans: readonly P[],
) {
  const lead = plans.filter((plan) => plan.role === "leader");
  const leave = plans.filter((plan) => plan.role !== "leader");
  return {
    lead,
    leave,
    /** Delete-or-leave is offered for any selection. */
    destructive: lead.length > 0,
    archive: plans.length > 0 && leave.length === 0,
    deleteLabel:
      lead.length > 0
        ? "Delete or leave the selected plans"
        : "Leave the selected plans",
  };
}

/** The one confirm for a bulk Delete and leave on the plans list, naming each
 *  count. Leaving alone is not destructive (`destructive`: no danger tone or
 *  trash icon). Guard: plans.test.ts ("tripPlanBulkConfirm"). */
export function tripPlanBulkConfirm(counts: { lead: number; leave: number }) {
  const { lead, leave } = counts;
  const plans = (count: number) => `${count} ${count === 1 ? "plan" : "plans"}`;
  const parts: string[] = [];
  if (lead > 0)
    parts.push(
      `Deleting ${plans(lead)} removes ${lead === 1 ? "its" : "their"} write-up${lead === 1 ? "" : "s"}, forms and everyone's answers, for everyone. Copies people saved to their own accounts stay.`,
    );
  if (leave > 0)
    parts.push(
      `Leaving ${plans(leave)} loses you access at once and removes your answers. What you added stays.`,
    );
  const title =
    lead > 0 && leave > 0
      ? `Delete ${plans(lead)} and leave ${plans(leave)}?`
      : lead > 0
        ? `Delete ${plans(lead)}?`
        : `Leave ${plans(leave)}?`;
  return {
    confirmTitle: title,
    confirmBody: parts.join(" "),
    confirmLabel: lead > 0 ? "Delete" : "Leave",
    destructive: lead > 0,
  };
}

export function tripPlanLetInMessage(username: string): string {
  return `${username} is in.`;
}

export function tripPlanRemovedMessage(username: string): string {
  return `${username} removed.`;
}

/**
 * What a plan holds, as its delete confirm and its On the map view count it:
 * a way is a route or a standalone file (an import or a recording).
 */
export function tripPlanCounts(plan: {
  places: readonly unknown[];
  routes: readonly unknown[];
  files: readonly unknown[];
}): { places: number; ways: number } {
  return {
    places: plan.places.length,
    ways: plan.routes.length + plan.files.length,
  };
}

/**
 * The files a person's storage pays for in a plan: what removing them moves
 * to the leader's storage, or deletes (planMembers.ts, `deleteFiles`).
 */
export function tripPlanFilesChargedTo(
  plan: Pick<TripPlanView, "files" | "places">,
  userId: string,
): { count: number; bytes: number } {
  const files = [
    ...plan.files,
    ...plan.places.flatMap((place) => place.media),
  ].filter((file) => file.chargedTo?.id === userId);
  return {
    count: files.length,
    bytes: files.reduce((sum, file) => sum + Number(file.sizeBytes), 0),
  };
}

/** Where each kind is listed: a plan's Map view and Add a place or way group them
 *  the same way. */
export const TRIP_PLAN_ITEM_GROUP = {
  place: "places",
  route: "ways",
  media: "ways",
} as const satisfies Record<TripPlanItemKind, "places" | "ways">;

export type TripPlanItemGroup = (typeof TRIP_PLAN_ITEM_GROUP)[TripPlanItemKind];

/** The groups in list order, with their headings. */
export const TRIP_PLAN_ITEM_GROUPS: readonly {
  group: TripPlanItemGroup;
  title: string;
}[] = [
  { group: "places", title: TRIP_PLAN_PAGE.copy.itemsPlaces },
  { group: "ways", title: TRIP_PLAN_PAGE.copy.itemsWays },
];

/**
 * What of the caller's own Add a place or way offers: their places, routes and
 * files. A place brings its linked route always,
 * and its files with its photos (api/src/lib/planItems.ts `addPlace`), so a
 * route or file of a place that is ticked is not offered again while it
 * would come with it, and is offered while it would not. Guard: plans.test.ts
 * ("what Add a place or way offers").
 */
export function tripPlanAddable<
  P extends { id: string },
  R extends { ownerId: string; placeId: string | null },
  F extends { linkedPlaceId: string | null },
>(
  own: { places: P[]; routes: R[]; files: F[] },
  state: { me: string | null; tickedPlaceIds: string[] },
): { places: P[]; routes: R[]; files: F[] } {
  const ticked = (placeId: string | null) =>
    placeId != null && state.tickedPlaceIds.includes(placeId);
  return {
    places: own.places,
    routes: own.routes.filter(
      (route) => route.ownerId === state.me && !ticked(route.placeId),
    ),
    files: own.files.filter((file) => !ticked(file.linkedPlaceId)),
  };
}

/** The add dialog's submit: "Add 3 places or ways", and the plain verb before a tick
 *  (a zero is left out, shared/DESIGN.md §11). */
export function tripPlanAddCopiesLabel(count: number): string {
  if (count === 0) return "Add a place or way";
  return count === 1 ? "Add 1 place or way" : `Add ${count} places or ways`;
}

/** What landed, said once the loop ends: the API's sentence for a stop. */
export function tripPlanAddedMessage(added: number, asked: number): string {
  if (added === asked)
    return added === 1
      ? "Added 1 place or way."
      : `Added ${added} places or ways.`;
  return `Added ${added} of ${asked}.`;
}

/** The price line above Add a place or way's submit. `uses` is null when only
 *  places are ticked: their photos can't be sized from the list. */
export function tripPlanAddCopyPrice(
  uses: string | null,
  left: string,
): string {
  const room = `You have ${left} left.`;
  return uses ? `Uses ${uses} of your storage. ${room}` : room;
}

/**
 * Add a place or way's price line, or null while nothing ticked is priced: what the
 * ticked files use of the storage left, and "Photos count too." when ticked
 * places bring their photos (their size isn't in the list). Null too until
 * the account's storage is known.
 */
export function tripPlanAddCopyPriceLine(args: {
  /** The ticked files' sizes, summed. */
  bytes: number;
  /** A place is among what is sent. */
  placesPicked: boolean;
  quotaBytes: number | null;
  usedBytes: number | null;
}): string | null {
  const photosToo = args.placesPicked;
  if (args.quotaBytes == null || args.usedBytes == null) return null;
  if (args.bytes === 0 && !photosToo) return null;
  const line = tripPlanAddCopyPrice(
    args.bytes > 0 ? formatBytes(args.bytes) : null,
    formatBytes(Math.max(0, args.quotaBytes - args.usedBytes)),
  );
  return photosToo ? `${line} ${TRIP_PLAN_PAGE.copy.photosCountToo}` : line;
}

/** An Add a place or way row's tick: what both clients store and `tripPlanAddPicks` matches. */
export const tripPlanAddKey = (row: { kind: string; id: string }) =>
  `${row.kind}:${row.id}`;

/**
 * What Add a place or way sends: the ticked rows still offered, in list order. A
 * tick whose row a ticked place now brings is not sent (it would be copied
 * twice); it comes back ticked if that place is unticked.
 */
export function tripPlanAddPicks<T extends { kind: string; id: string }>(
  offered: readonly T[],
  ticked: readonly string[],
): T[] {
  return offered.filter((row) => ticked.includes(tripPlanAddKey(row)));
}

/**
 * How an Add a place or way run ended, as its toast says it: what landed, the photos
 * that didn't come, and why it stopped. Null when nothing landed: the dialog
 * stays open with the reason.
 */
export function tripPlanAddOutcome(args: {
  added: number;
  asked: number;
  skipped: number;
  outOfSpace: boolean;
  /** The stop's reason, when one stopped the run. */
  why: string | null;
}): { message: string; tone: "info" | "error" } | null {
  if (args.added === 0) return null;
  const photos = mediaSkippedSentence(args.skipped, args.outOfSpace);
  return {
    message: [tripPlanAddedMessage(args.added, args.asked), photos, args.why]
      .filter(Boolean)
      .join(" "),
    tone: photos || args.why ? "error" : "info",
  };
}

/** Start a trip log's line: what saving the picked places brings. Photos
 *  are promised only when a picked place has some. */
export function tripPlanTripLogPlacesLine(
  picked: readonly { media: readonly unknown[] }[],
  withPhotos: boolean,
): string {
  if (!picked.some((place) => place.media.length > 0))
    return "Each place you pick is saved to your places first, then linked.";
  return `Each place you pick is saved to your places first, ${withPhotos ? "with" : "without"} its photos, then linked.`;
}

/** Start a trip log stopped partway: what is in the user's places already. */
export function tripPlanTripLogStopped(saved: number, why: string): string {
  if (saved === 0) return why;
  return `${saved === 1 ? "1 copy" : `${saved} copies`} saved to your places. ${why}`;
}

/** Where Save a copy put it. */
export function tripPlanSavedMessage(kind: TripPlanItemKind): string {
  return `Saved a copy to your ${kind === "place" ? "places" : "ways"}.`;
}

// ── Plans list: bulk actions ────────────────────────────────────────

/** The toast after a bulk run: all done, or how many of them. Guard:
 *  plans.test.ts ("tripPlanBulkDone"). */
export function tripPlanBulkDone(
  kind: "delete" | "leave" | "archive" | "unarchive",
  done: number,
  total: number,
): string {
  const verb = {
    delete: "Deleted",
    leave: "Left",
    archive: "Archived",
    unarchive: "Brought back",
  }[kind];
  const plans = total === 1 ? "1 plan" : `${total} plans`;
  return done === total
    ? `${verb} ${plans}.`
    : `${verb} ${done} of ${plans}. The rest didn't go through.`;
}
