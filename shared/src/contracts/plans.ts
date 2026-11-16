// Plans: the list, a plan's page and joining one. Logjam Web's
// `PlansPanel.tsx`, `PlanDetailPanel.tsx` and `PlanJoinDialog.tsx`; Logjam
// GPS's plans screens. A plan's verbs are `planVerbs.ts`; the wire shapes,
// limits and presets are `../tripPlans.ts`.
import type { IconIdea } from "../icons.js";
import {
  currentTripPlanAnswers,
  TRIP_PLAN_INVITE_TTL_DAYS,
  TRIP_PLAN_ROLES,
  tripPlanVisibilityLockedSentence,
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
  type TripPlanPlace,
  type TripPlanRole,
  type TripPlanSummary,
  type TripPlanUserRef,
  type TripPlanView,
} from "../tripPlans.js";
import { SYSTEM_PLACE_TYPES } from "../placeTypes.js";
import type { ScreenContract } from "./types.js";
import { formatBytes } from "../format.js";
import { friendMatches } from "../friendSearch.js";
import { mediaSkippedSentence } from "../friendShareRows.js";
import { todayDateKey } from "../logbook.js";
import { PLACE_FORM } from "./placeForm.js";
import {
  type Day,
  dayOfKey,
  formatWeekdayDay,
  formatWeekdayDayMonth,
  formatWeekdayDayMonthYear,
} from "../dateFormat.js";
import { plural, t } from "../i18n.js";

export const TRIP_PLANS_LIST = {
  id: "plans.list",
  question: t`What trips am I getting ready for?`,
  title: t`Plans`,
  sections: [
    { key: "hero" },
    // One rail, a true partition: a plan is upcoming, over, or put away.
    { key: "buckets" },
    { key: "list" },
  ],
  copy: {
    add: t`New plan`,
    buckets: t`Plans`,
    bucketUpcoming: t`Upcoming`,
    bucketPast: t`Past`,
    bucketArchived: t`Archived`,

    loading: t`Loading your plans…`,
    loadFailed: t`Couldn't load your plans.`,
    firstRunTitle: t`No plans yet`,
    firstRunBody: t`A plan is where a group gets ready for a trip: the write-up, the places and ways, who's coming and their details.`,
    noUpcomingTitle: t`Nothing coming up`,
    noPastTitle: t`No past plans`,
    noPastBody: t`A plan moves here once its dates have passed.`,
    noArchivedTitle: t`Nothing archived`,
    // The hero's line and Logjam GPS's More row, when nothing is coming up.
    nothingPlanned: t`Nothing planned`,

    noDates: t`No dates yet`,
    pillLeader: t`Leader`,
    pillEditor: t`Editor`,
    // Never a pill on a row (a member's own role says nothing); a word where
    // every role is named, such as the invite's role picker and a printout.
    // Guard: plans.test.ts (a member's row says nothing).
    roleMember: t`Member`,
    pillInvited: t`Invited`,
    pillWaiting: t`Waiting`,
    open: t`Open`,
    decline: t`Decline`,
    declined: t`Invite declined.`,
    declineFailed: t`Couldn't decline the invite.`,
    withdrawn: t`Request withdrawn.`,
    withdrawFailed: t`Couldn't withdraw the request.`,

    // The one form for a plan's name, dates and types: New plan, and Edit.
    newTitle: t`New plan`,
    editTitle: t`Edit plan`,
    name: t`Name`,
    namePlaceholder: t`For example, Kanangra weekend`,
    nameRequired: t`Give the plan a name.`,
    tripTypes: t`Trip types`,
    addTripType: t`Add a type`,
    make: t`Make plan`,
    save: t`Save`,
    makeFailed: t`Couldn't make the plan.`,
    saveFailed: t`Couldn't save the plan.`,

    archiveSelected: t`Archive the selected plans`,
    unarchiveSelected: t`Bring back the selected plans`,
  },
} as const satisfies ScreenContract;

/** A plan card's ⋯ label. */
export const tripPlanCardActionsLabel = (name: string) =>
  t`Actions for ${name}`;

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
    // A new plan would not land here, so the state says where plans arrive
    // instead of offering one.
    body: bucket === "past" ? copy.noPastBody : undefined,
  };
}

/**
 * "Sat 8 – Sun 9 Nov", "Fri 31 Oct – Sun 2 Nov", "Sat 8 Nov", "No dates yet".
 * The year shows only when it is not this year's. A date-only value is a
 * calendar day, so no time zone touches it.
 */
export function tripPlanDatesLabel(
  startDate: DateOnly | null,
  endDate: DateOnly | null,
  thisYear: number = new Date().getFullYear(),
): string {
  if (startDate == null && endDate == null) return TRIP_PLANS_LIST.copy.noDates;
  if (startDate == null)
    return t`Until ${tripPlanDayLabel(endDate!, thisYear)}`;
  if (endDate == null || endDate === startDate)
    return tripPlanDayLabel(startDate, thisYear);
  const start = dayOfKey(startDate);
  const end = dayOfKey(endDate);
  const startText =
    start.year !== end.year
      ? dayLabel(start, thisYear)
      : start.month !== end.month
        ? formatWeekdayDayMonth(start)
        : formatWeekdayDay(start);
  return t`${startText} – ${dayLabel(end, thisYear)}`;
}

/** "Sat 8 Nov", or "Sat 8 Nov 2025" in another year. */
export function tripPlanDayLabel(
  date: DateOnly,
  thisYear: number = new Date().getFullYear(),
): string {
  return dayLabel(dayOfKey(date), thisYear);
}

function dayLabel(day: Day, thisYear: number): string {
  return day.year === thisYear
    ? formatWeekdayDayMonth(day)
    : formatWeekdayDayMonthYear(day);
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

/** The printed summary's last line, `printed` being the day it was printed. */
export function tripPlanPrintFooter(printed: string): string {
  return t`From Logjam Web, ${printed}. Correct when printed; the plan may have changed since.`;
}

/** Above Send when required questions are empty: how many are owed. */
export function tripPlanRequiredSummary(count: number): string {
  return plural(
    count,
    "Answer the question marked required.",
    "Answer the # questions marked required.",
  );
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
    return t`${tripPlanDatesLabel(plan.startDate, plan.endDate, thisYear)} · From ${plan.invitedBy.username}`;
  return tripPlanDatesLabel(plan.startDate, plan.endDate, thisYear);
}

export function tripPlanWaitingLine(username: string): string {
  return t`Waiting for ${username} to accept you`;
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
  if (now) return t`On now: ${now.name}`;
  const next = coming[0];
  if (!next) return TRIP_PLANS_LIST.copy.nothingPlanned;
  return t`Next: ${next.name}, ${
    next.startDate
      ? tripPlanDayLabel(next.startDate, thisYear)
      : t`until ${tripPlanDayLabel(next.endDate!, thisYear)}`
  }`;
}

// ── A plan's page ───────────────────────────────────────────────────

export const TRIP_PLAN_PAGE = {
  id: "plans.page",
  question: t`What do I need to know and do for this trip?`,
  sections: [
    // The name, the way back to Plans, Add ▾ and the plan's ⋯.
    { key: "hero" },
    // At most one, by priority (`tripPlanNotice`).
    { key: "notices" },
    // One rail over the four views below; only the chosen one is drawn.
    { key: "views" },
    // Starts with one line: dates · trip types · the caller's role
    // (`tripPlanDatesLine`), then the sections, their text drawn as Markdown
    // (`planWriteUpBlocks`). Both clients, so it is not a header section.
    { key: "writeUp" },
    // Above On the map's rows, while that view is chosen and has a place or
    // a way: the map in plan mode, the plan's items only.
    {
      key: "showOnMap",
      on: "gps",
      reason: t`On Logjam Web the map sits beside the plan's page and already shows only the plan's items while it is open. On Logjam GPS the page covers the map.`,
    },
    // On Logjam GPS a place row, and its pin in plan mode, opens a read-only
    // sheet; Logjam Web fits its map to the place instead, the map beside
    // the page.
    { key: "items" },
    { key: "forms" },
    { key: "people" },
  ],
  copy: {
    back: t`Back to plans`,
    showOnMap: t`Show on map`,
    add: t`Add`,
    addMenu: t`Add to this plan`,
    actions: t`Plan actions`,

    // The map while a plan is open.
    barPrefix: t`Plan:`,
    backToMap: t`Back to my map`,

    noticeArchived: t`Archived. A leader can bring it back to change it.`,
    noticeOver: t`This trip is over.`,
    roleLeader: t`You're a leader`,
    roleEditor: t`You're an editor`,

    // The one-calendar date range field.
    datesField: t`Dates`,
    datesNone: t`No dates yet`,
    datesPrevMonth: t`Previous month`,
    datesNextMonth: t`Next month`,
    datesClear: t`Clear dates`,

    views: t`Plan view`,
    viewWriteUp: t`Write-up`,
    viewItems: t`Map`,
    viewForms: t`Forms`,
    viewPeople: t`People`,

    loading: t`Loading the plan…`,
    loadFailed: t`Couldn't load the plan.`,

    // The write-up.
    writeUpEmpty: t`Nothing written yet.`,
    writeUpEmptyTitle: t`No write-up yet`,
    writeUpEmptyBody: t`Sections for the route, the meeting point and what to bring go here.`,
    sectionTitle: t`Write-up section`,
    sectionNewTitle: t`New write-up section`,
    sectionTitleField: t`Title`,
    sectionBody: t`Text`,
    sectionBodyHint: t`Markdown works: **bold**, - lists, [links](https://example.com).`,
    sectionTitlePlaceholder: t`For example, Overview, Gear or Access`,
    sectionSave: t`Save`,
    sectionSaveFailed: t`Couldn't save the section.`,
    sectionGone: t`This section was deleted.`,
    // After the plan changed under an open form: under the field it changed.
    inPlanNow: t`In the plan now:`,
    inPlanNowEmpty: t`nothing`,
    sectionMoveFailed: t`Couldn't move the section.`,
    sectionDeleteFailed: t`Couldn't delete the section.`,
    sectionDeleted: t`Section deleted.`,

    // The things on the map.
    itemsPlaces: t`Places`,
    itemsWays: t`Ways`,
    itemsEmpty: t`Places and ways you add show up here.`,
    addCopyLine: t`Everyone in this plan, including people who join later, can see and copy what you add to it.`,
    searchByName: t`Search by name`,
    searchNoMatch: t`Nothing matches that name.`,
    photosCountToo: t`Photos count too.`,
    addCopyFailed: t`Couldn't add that.`,
    nothingToAdd: t`Nothing of yours here yet.`,
    nothingTicked: t`Tick something to add.`,
    saveCopyLine: t`The copy is yours. Changes to it stay with you, and changes in the plan don't reach it.`,
    saveCopyFailed: t`Couldn't save a copy.`,
    itemDeleteFailed: t`Couldn't delete that.`,
    itemDeleted: t`Deleted from the plan.`,
    itemEdit: t`Edit`,
    itemEditPlace: t`Edit place`,
    itemEditWay: t`Edit way`,
    inPlan: t`In the plan`,
    sectionEmpty: t`No text yet.`,
    printFormsNote: t`Only the Carpooling and Safety contacts forms can be printed, and only when everyone in the plan sees the answers.`,
    printIntro: t`For someone not on the trip, such as a parent. It's a file you keep or send, not a link.`,
    printGoing: t`Who's going`,
    printSubmit: t`Print or save as PDF`,
    printLeaders: t`Leaders:`,
    itemName: t`Name`,
    itemNotes: t`Notes`,
    itemSaveFailed: t`Couldn't save that.`,
    itemGone: t`This was deleted from the plan.`,
    itemAlsoKnownAs: PLACE_FORM.copy.alsoKnownAs,
    itemAlsoKnownAsHint: PLACE_FORM.copy.alsoKnownAsHint,
    itemLatitude: t`Latitude`,
    itemLongitude: t`Longitude`,
    itemElevation: t`Elevation (m)`,
    itemAttributes: t`Attributes`,
    itemDownloadHint: t`Click to download`,
    placeTypeFallback: t`Place`,
    placeSetAside: t`Set aside`,
    placeSetAsideHint: t`The person who added this place had these attributes, and its type here doesn't have them. Save a copy to keep them.`,
    placeCopyFailed: t`Couldn't copy the coordinates.`,
    tripLogPlaces: t`Places on this trip`,
    tripLogNext: t`Next`,

    // Forms.
    formsEmpty: t`No forms yet`,
    formsEmptyBodyLeader: t`Start from gear, carpooling, experience, first aid, safety contacts or trip rules.`,
    formsEmptyBody: t`A leader adds forms for everyone to fill in.`,
    pillNotAnswered: t`Not answered`,
    seenByLeaders: t`Leaders see answers`,
    seenByMembers: t`Everyone sees answers`,
    answer: t`Answer`,
    changeAnswer: t`Change my answer`,
    myAnswer: t`Your answer`,
    everyonesAnswers: t`Answers`,
    noAnswerYet: t`No answer yet`,

    // People.
    peopleAsking: t`Asking to join`,
    peopleGoing: t`Going`,
    peopleInvited: t`Invited`,
    letIn: t`Accept`,
    turnDown: t`Decline`,
    roleFailed: t`Couldn't change their role.`,
    letInFailed: t`Couldn't accept them.`,
    turnDownFailed: t`Couldn't decline them.`,
    turnedDown: t`Request declined.`,
    removeFailed: t`Couldn't remove them.`,
    cancelInvite: t`Cancel invite`,
    personUnanswered: t`Hasn't answered`,
    cancelInviteFailed: t`Couldn't cancel the invite.`,
    inviteCancelled: t`Invite cancelled.`,

    archived: t`Archived. It's under Archived in Plans.`,
    unarchived: t`Brought back.`,
    archiveFailed: t`Couldn't archive the plan.`,
    deleted: t`Plan deleted.`,
    deleteFailed: t`Couldn't delete the plan.`,
    left: t`You left the plan.`,
    leaveFailed: t`Couldn't leave the plan.`,
  },
} as const satisfies ScreenContract;

/** The place dialog's copy-the-coordinates button, named for its place
 *  (`TRIP_PLAN_PAGE.copy.placeCopyFailed` is its failure). */
export function tripPlanCopyCoordinatesLabel(name: string): string {
  return t`Copy the coordinates of ${name}`;
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
    return t`Only the plan's leaders see your answers.`;
  const line = t`Everyone in this plan sees your answers, including people who join later.`;
  return preset && TRIP_PLAN_PRINTED_PRESETS.includes(preset)
    ? t`${line} Members may print them for someone not on the trip, such as a parent.`
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

/**
 * A plan place's type as shown: the adder's custom type by name and icon key,
 * else the system type's own. An icon key a client lacks falls back in that
 * client's own mapping. Guard: plans.test.ts ("a plan place's type").
 */
export function tripPlanPlaceType(
  place: Pick<TripPlanPlace, "placeTypeId" | "typeName" | "typeIconKey">,
): { name: string; iconKey: string } {
  const system = SYSTEM_PLACE_TYPES.find(
    (each) => each.id === place.placeTypeId,
  );
  return {
    name:
      place.typeName ?? system?.name ?? TRIP_PLAN_PAGE.copy.placeTypeFallback,
    iconKey: place.typeIconKey ?? system?.iconKey ?? "map-pin",
  };
}

/** The set-aside attributes of a plan place as read-only rows: key, label,
 *  value, type (the shape `attributeRows` returns). */
export function tripPlanSetAsideRows(
  place: Pick<TripPlanPlace, "foreignFields">,
): [string, string, unknown, string][] {
  return (place.foreignFields ?? []).map((item) => [
    item.key,
    item.label,
    item.value,
    item.type,
  ]);
}

/** "Added by tom", or nothing once the adder's account is gone. */
export function tripPlanAddedByLine(
  addedBy: { username: string } | null,
): string | undefined {
  return addedBy ? t`Added by ${addedBy.username}` : undefined;
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
  question: t`Do I want to join this trip, and what do they need from me?`,
  sections: [
    // The name, the dates and who leads it.
    { key: "hero" },
  ],
  copy: {
    leader: t`Leader:`,
    invitedBy: t`Invited by`,
    askToJoin: t`Ask to join`,
    join: t`Join`,
    decline: t`Decline`,
    joinFailed: t`Couldn't join the plan.`,
    joined: t`You joined the plan.`,
    joining: t`Joining…`,
    cancel: t`Cancel`,
    declineTitle: t`Decline this invite?`,
    declineBody: t`The invite goes away. A leader would have to invite you again.`,
    linkFailed: t`This invite link no longer works. Ask for a new one.`,
    signIn: t`A trip invite is waiting. Create an account or sign in to see it.`,
  },
} as const satisfies ScreenContract;

/**
 * A plan someone is invited to by username, before they join
 * (GET /plans/:id/preview): what they would join and what it asks first,
 * with Join and Decline. Its words are the join dialog's and the plan page's.
 */
export const TRIP_PLAN_PREVIEW = {
  id: "plans.preview",
  question: t`What would I be joining, and what does it ask first?`,
  sections: [
    // The name, then "dates · trip types" (`tripPlanInvitePage`).
    { key: "hero" },
    // "carol invited you", what joining shows, and Join and Decline.
    { key: "notice" },
    // Always a group, an empty line when nothing is written, so "Going"
    // always has one to divide from (shared/DESIGN.md §2).
    { key: "writeUp" },
    { key: "people" },
  ],
  // The join dialog's and the plan page's words, not a second copy.
  copy: {
    invited: t`You're invited`,
    joinHint: t`Joining lets everyone in the plan see you're going.`,
    writeUpEmpty: TRIP_PLAN_PAGE.copy.writeUpEmpty,
    gone: t`This invite is gone: it was withdrawn, or the plan was deleted.`,
    join: TRIP_PLAN_JOIN.copy.join,
    decline: TRIP_PLAN_JOIN.copy.decline,
    declined: TRIP_PLANS_LIST.copy.declined,
    declineFailed: TRIP_PLANS_LIST.copy.declineFailed,
    people: TRIP_PLAN_PAGE.copy.peopleGoing,
    loading: TRIP_PLAN_PAGE.copy.loading,
    loadFailed: TRIP_PLAN_PAGE.copy.loadFailed,
  },
} as const satisfies ScreenContract;

/**
 * What the invited preview shows, in the order of `TRIP_PLAN_PREVIEW`'s
 * sections, for both clients: the facts under the name, the invite's own
 * words, the write-up (or its empty line) and who is going.
 */
export function tripPlanInvitePage(
  preview: Pick<
    TripPlanInvitedPreview,
    "startDate" | "endDate" | "tripTypes" | "invitedBy" | "sections" | "members"
  >,
  typeLabel: (type: string) => string,
  thisYear?: number,
) {
  const copy = TRIP_PLAN_PREVIEW.copy;
  return {
    facts: [
      tripPlanDatesLabel(preview.startDate, preview.endDate, thisYear),
      ...preview.tripTypes.map(typeLabel),
    ].join(" · "),
    inviteTitle: preview.invitedBy
      ? t`${preview.invitedBy.username} invited you`
      : copy.invited,
    inviteHint: copy.joinHint,
    sections: preview.sections,
    writeUpEmpty: preview.sections.length === 0 ? copy.writeUpEmpty : null,
    going: { title: copy.people, count: preview.members.length },
  };
}

/** The join dialog's title. */
export function tripPlanJoinTitle(planName: string): string {
  return t`Join ${planName}`;
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
  title: t`Invite people`,
  question: t`Who else should come, and how do they get in?`,
  sections: [
    // The username search and the role they will get.
    { key: "search" },
    // Or a link: the hint, Copy and Share, then the live links.
    { key: "link" },
  ],
  copy: {
    back: t`Back to people`,
    searchField: t`Search friends or usernames`,
    friends: t`Friends`,
    others: t`Other people`,
    othersHint: t`Not a friend yet? Type their username to find them. People you invite need not be friends.`,
    role: t`Role`,
    inviteSend: t`Invite`,
    invited: t`Invited.`,
    inviteFailed: t`Couldn't invite them.`,
    linkHint: t`Or send a link. Anyone with the link can ask to join. A leader lets each person in. It works for ${TRIP_PLAN_INVITE_TTL_DAYS} days.`,
    linkCopy: t`Copy invite link`,
    linkShare: t`Share invite link`,
    linkCopied: t`Invite link copied.`,
    linkMakeFailed: t`Couldn't make an invite link.`,
    linkCopyFailed: t`Couldn't copy the invite link.`,
    linkRevoke: t`Turn off`,
    linkRevoked: t`That link no longer works.`,
    linkRevokeFailed: t`Couldn't turn off the link.`,
    linksLive: t`Links that work`,
    inPlan: t`In this plan`,
    searchFailed: t`Couldn't search users.`,
  },
} as const satisfies ScreenContract;

/** What each role can do, as Invite people tells it before a leader picks.
 *  Which verbs a role runs is `PLAN_VERBS` and the lists beside it. */
export const TRIP_PLAN_ROLE_ABOUT: Record<TripPlanRole, string> = {
  member: t`sees the plan, adds places and ways, answers forms and can leave.`,
  editor: t`also edits the plan and its write-up.`,
  leader: t`also invites people, sets roles, runs forms, archives and deletes the plan.`,
};

/** Invite people's two lists: friends matching what is typed (all of them
 *  when nothing is), then the people the username search found who are not
 *  friends. */
export function tripPlanInviteLists<P extends { id: string; username: string }>(
  friends: readonly P[],
  found: readonly P[],
  query: string,
): { friends: P[]; others: P[] } {
  const ids = new Set(friends.map((friend) => friend.id));
  return {
    friends: friends.filter((friend) => friendMatches(friend.username, query)),
    others: found.filter((person) => !ids.has(person.id)),
  };
}

/** A live invite link's row: "Made Mon 19 Oct, works until Mon 26 Oct",
 *  each the day it is where the reader is. */
export function tripPlanInviteLinkLine(
  link: { createdAt: string; expiresAt: string },
  thisYear?: number,
): string {
  const day = (instant: string) =>
    tripPlanDayLabel(todayDateKey(new Date(instant)), thisYear);
  return t`Made ${day(link.createdAt)}, works until ${day(link.expiresAt)}`;
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
  return t`Asked to join. ${leader} will accept you.`;
}

/** What goes in the message a plan link is sent with. */
export function tripPlanInviteMessage(planName: string, url: string): string {
  return t`Join ${planName} on Logjam: ${url}`;
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
  question: t`What does this form ask, and what did people answer?`,
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
      reason: t`A table a column per question needs a desk's width; Logjam GPS lists each person's answers under their name.`,
    },
    {
      key: "list",
      on: "gps",
      reason: t`A phone is too narrow for a column per question, so each person's answers stack under their name.`,
    },
  ],
  copy: {
    back: t`Back to the plan`,
    actions: t`Form actions`,
    mine: t`Your answer`,
    answers: t`Answers`,
    answer: t`Answer`,
    change: t`Change my answer`,
    noAnswer: t`You haven't answered yet.`,
    noAnswerYet: t`No answer yet`,
    member: t`Member`,
    asking: t`Asking to join`,
    save: t`Send`,
    saveFailed: t`Couldn't send your answer.`,
    // Under one empty required question; `tripPlanRequiredSummary` is above Send.
    required: t`Required.`,
    saved: t`Answer sent.`,
    deleteFailed: t`Couldn't delete the form.`,
    deleted: t`Form deleted.`,

    // The builder, on both clients (`PLAN_FORM_VERBS`).
    newTitle: t`New form`,
    editTitle: t`Edit form`,
    startFrom: t`Start from`,
    blank: t`A blank form`,
    title: t`Title`,
    titlePlaceholder: t`For example, Gear to borrow`,
    questionPlaceholder: t`For example, What size wetsuit do you wear?`,
    visibleTo: t`Who sees the answers`,
    visibleToLeaders: t`Leaders`,
    visibleToMembers: t`Everyone in the plan`,
    // The API's refusal, said before Save. A getter, so it is written when read
    // and not when this module loads (contractLanguage.test.ts).
    get visibleToLocked() {
      return tripPlanVisibilityLockedSentence();
    },
    questions: t`Questions`,
    // After a 409, over questions another leader saved meanwhile.
    questionsChanged: t`Another leader changed these questions since you opened the form. Saving keeps yours.`,
    questionLabel: t`Question`,
    questionKind: t`Kind`,
    questionHelp: t`Hint`,
    questionRequired: t`Required`,
    options: t`Options`,
    optionLabel: t`Option`,
    addOption: t`Add an option`,
    removeOption: t`Remove option`,
    addQuestion: t`Add a question`,
    removeQuestion: t`Remove question`,
    moveUp: t`Move up`,
    moveDown: t`Move down`,
    add: t`Add form`,
    saveForm: t`Save`,
    formSaveFailed: t`Couldn't save the form.`,
    titleNeeded: t`Give the form a title.`,
    // The chooser a new form starts from.
    chooseTemplates: t`Templates`,
    chooseMine: t`From your other plans`,
    chooseBlankHint: t`Write your own questions.`,
    chooseBack: t`Back`,
    chooseFrom: t`From`,
    chooseMineLoading: t`Loading your forms…`,
    chooseMineFailed: t`Couldn't load your forms from other plans.`,
    chooseMineEmpty: t`Forms you make in other plans you lead show up here.`,
    formSaved: t`Form saved.`,
    yes: t`Yes`,
    no: t`No`,
    agreed: t`Agreed`,
  },
} as const satisfies ScreenContract;

/** One line under each template in the new-form chooser. */
export const TRIP_PLAN_FORM_PRESET_BLURBS: Record<
  TripPlanFormPresetId,
  string
> = {
  gear: t`Who needs to borrow what, and wetsuit sizes.`,
  carpool: t`Who can drive, who needs a lift, and from where.`,
  experience: t`How much canyoning and abseiling people have done.`,
  firstAid: t`First aid training and what people carry.`,
  safetyContacts: t`Someone to call, and medical details people choose to share.`,
  rules: t`The trip's ground rules, for each person to agree to.`,
};

/** Each question kind's name in the builder. */
export const TRIP_PLAN_QUESTION_KIND_LABELS: Record<
  TripPlanQuestionKind,
  string
> = {
  text: t`Short answer`,
  longText: t`Paragraph`,
  phone: t`Phone number`,
  number: t`Number`,
  choice: t`One from a list`,
  multiChoice: t`Tick list`,
  yesNo: t`Yes or no`,
  agree: t`A box to tick`,
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

/** What a table cell holds for an answer that is missing or blank. */
export const TRIP_PLAN_ANSWER_MISSING = "\u2014";

/**
 * The answers table both clients draw: a column per question, a row per
 * person (`tripPlanAnswerRows`' order and audience), every cell already
 * words. A blank or missing answer is `TRIP_PLAN_ANSWER_MISSING`; `answered`
 * is false for someone with no answer at all, so a client can say so once
 * rather than per cell.
 */
export function tripPlanAnswerTable(
  form: Pick<TripPlanFormView, "answers" | "myAnswer" | "questions">,
  members: Parameters<typeof tripPlanAnswerRows>[1],
) {
  const { going, asking } = tripPlanAnswerRows(form, members);
  const row = ({
    user,
    answer,
  }: {
    user: TripPlanUserRef;
    answer?: TripPlanAnswerView;
  }) => {
    const values = answer
      ? currentTripPlanAnswers(form.questions, answer.answers)
      : null;
    return {
      user,
      answered: answer != null,
      cells: form.questions.map(
        (question) =>
          (values && tripPlanAnswerText(question, values[question.id])) ||
          TRIP_PLAN_ANSWER_MISSING,
      ),
    };
  };
  return {
    columns: form.questions.map(({ id, label }) => ({ id, label })),
    going: going.map(row),
    asking: asking.map(row),
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
  return plural(count, "# form to answer", "# forms to answer");
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
 * Whether one form wears "Not answered" for the caller: they haven't answered
 * it, and the plan is neither archived nor over. Any role, a leader included;
 * only the nudge card and the list count leave leaders out.
 * Guard: plans.test.ts ("form unanswered").
 */
export function tripPlanFormUnanswered(
  plan: Pick<TripPlanView, "startDate" | "endDate" | "archivedAt">,
  form: Pick<TripPlanFormView, "myAnswer">,
  today: DateOnly,
): boolean {
  return (
    form.myAnswer == null && !plan.archivedAt && !tripPlanIsOver(plan, today)
  );
}

/**
 * The forms the caller hasn't answered, in the plan's order, and whether the
 * nudge is urgent: the trip's first day is within 7 days (or has come), by
 * date key. Nothing to answer once the trip is over or the plan archived,
 * and a leader is never nudged: they made the forms and can change them.
 * Guard: plans.test.ts ("forms to answer").
 */
export function tripPlanFormsToAnswer(
  plan: Pick<
    TripPlanView,
    "forms" | "startDate" | "endDate" | "archivedAt" | "myRole"
  >,
  today: DateOnly,
): { forms: Pick<TripPlanFormView, "id" | "title">[]; urgent: boolean } {
  const forms =
    plan.myRole === "leader"
      ? []
      : plan.forms
          .filter((form) => tripPlanFormUnanswered(plan, form, today))
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

/** "3 of 5 answered", and "Not answered yet: bob, carol" when anyone is left.
 *  Where the viewer's own "Not answered" pill is on the same card
 *  (`viewerPill`), they are left out of the names, and the line with them
 *  when nobody else is left: the pill already says it.
 *  Guard: plans.test.ts ("form tally"). */
export function tripPlanFormTallyLines(
  tally: {
    answered: number;
    total: number;
    missing: readonly TripPlanUserRef[];
  },
  /** The viewer's id: their own name reads "you". */
  me?: string,
  viewerPill = false,
): string[] {
  const missing = viewerPill
    ? tally.missing.filter((user) => user.id !== me)
    : tally.missing;
  return [
    t`${tally.answered} of ${tally.total} answered`,
    ...(missing.length > 0
      ? [
          t`Not answered yet: ${missing.map((user) => (user.id === me ? t`you` : user.username)).join(", ")}`,
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
        ? t`Delete or leave the selected plans`
        : t`Leave the selected plans`,
  };
}

/** The one confirm for a bulk Delete and leave on the plans list, naming each
 *  count. Leaving alone is not destructive (`destructive`: no danger tone or
 *  trash icon). Guard: plans.test.ts ("tripPlanBulkConfirm"). */
export function tripPlanBulkConfirm(
  counts: { lead: number; leave: number },
  deleteAdded = false,
) {
  const { lead, leave } = counts;
  const plans = (count: number) => plural(count, "# plan", "# plans");
  const parts: string[] = [];
  if (lead > 0)
    parts.push(
      plural(
        lead,
        "Deleting # plan removes its write-up, forms and everyone's answers, for everyone. Copies people saved to their own accounts stay.",
        "Deleting # plans removes their write-ups, forms and everyone's answers, for everyone. Copies people saved to their own accounts stay.",
      ),
    );
  if (leave > 0)
    parts.push(
      deleteAdded
        ? plural(
            leave,
            "Leaving # plan loses you access at once and removes your answers. What you added is deleted too.",
            "Leaving # plans loses you access at once and removes your answers. What you added is deleted too.",
          )
        : plural(
            leave,
            "Leaving # plan loses you access at once and removes your answers. What you added stays.",
            "Leaving # plans loses you access at once and removes your answers. What you added stays.",
          ),
    );
  const title =
    lead > 0 && leave > 0
      ? plural(
          lead,
          "Delete # plan and leave {0}?",
          "Delete # plans and leave {0}?",
          plans(leave),
        )
      : lead > 0
        ? plural(lead, "Delete # plan?", "Delete # plans?")
        : plural(leave, "Leave # plan?", "Leave # plans?");
  return {
    confirmTitle: title,
    confirmBody: parts.join(" "),
    confirmLabel: lead > 0 ? t`Delete` : t`Leave`,
    destructive: lead > 0,
  };
}

/** Bulk leave's box. Off by default: leaving keeps what you added. */
export const TRIP_PLAN_BULK_DELETE_ADDED_LABEL = t`Also delete what I added`;

export function tripPlanLetInMessage(username: string): string {
  return t`${username} is in.`;
}

export function tripPlanRemovedMessage(username: string): string {
  return t`${username} removed.`;
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
 * Which of the caller's own places, routes and files are already in the plan.
 * A plan item records no source (a member must not learn the adder's row id),
 * so this matches by name and position: a place by name and coordinates, a
 * route by name and point count, a file by its shown name and size. A thing
 * renamed or moved since it was added is offered again. Client-side only; the
 * API takes a second add. Guard: plans.test.ts ("what is already in the plan").
 */
export function tripPlanInPlanIds(
  plan: Pick<TripPlanView, "places" | "routes" | "files">,
  own: {
    places: { id: string; name: string; latitude: number; longitude: number }[];
    routes: { id: string; name: string; points: unknown[] }[];
    files: {
      id: string;
      displayName?: string | null;
      filename?: string | null;
      fileSizeBytes?: number | null;
    }[];
  },
): Set<string> {
  const ids = new Set<string>();
  for (const place of own.places)
    if (
      plan.places.some(
        (p) =>
          p.name === place.name &&
          p.latitude === place.latitude &&
          p.longitude === place.longitude,
      )
    )
      ids.add(place.id);
  for (const route of own.routes)
    if (
      plan.routes.some(
        (r) => r.name === route.name && r.points.length === route.points.length,
      )
    )
      ids.add(route.id);
  for (const file of own.files) {
    const name = file.displayName ?? file.filename;
    if (
      plan.files.some(
        (f) =>
          (f.item.displayName ?? f.item.filename) === name &&
          (file.fileSizeBytes == null ||
            Number(f.sizeBytes) === file.fileSizeBytes),
      )
    )
      ids.add(file.id);
  }
  return ids;
}

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
  if (count === 0) return t`Add a place or way`;
  return plural(count, "Add # place or way", "Add # places or ways");
}

/** What landed, said once the loop ends: the API's sentence for a stop. */
export function tripPlanAddedMessage(added: number, asked: number): string {
  if (added === asked)
    return plural(added, "Added # place or way.", "Added # places or ways.");
  return t`Added ${added} of ${asked}.`;
}

/** The price line above Add a place or way's submit. `uses` is null when only
 *  places are ticked: their photos can't be sized from the list. */
export function tripPlanAddCopyPrice(
  uses: string | null,
  left: string,
): string {
  const room = t`You have ${left} left.`;
  return uses ? t`Uses ${uses} of your storage. ${room}` : room;
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
}): { message: string; tone: "done" | "error" } | null {
  if (args.added === 0) return null;
  const photos = mediaSkippedSentence(args.skipped, args.outOfSpace);
  return {
    message: [tripPlanAddedMessage(args.added, args.asked), photos, args.why]
      .filter(Boolean)
      .join(" "),
    tone: photos || args.why ? "error" : "done",
  };
}

/** Start a trip log's line: which of the plan's places the trip can link.
 *  Only those already in the caller's places are listed. */
export function tripPlanTripLogPlacesLine(
  matched: number,
  total: number,
): string {
  if (matched === 0)
    return t`None of this plan's places are in your places, so the trip links none.`;
  const left = total - matched;
  if (left === 0)
    return t`These are all in your places, so the trip can link any of them.`;
  return plural(
    left,
    "Only places you already have are listed; the other # is left out.",
    "Only places you already have are listed; the other # are left out.",
  );
}

/** Where Save a copy put it. */
export function tripPlanSavedMessage(kind: TripPlanItemKind): string {
  return kind === "place"
    ? t`Saved a copy to your places.`
    : t`Saved a copy to your ways.`;
}

// ── Plans list: bulk actions ────────────────────────────────────────

/** The toast after a bulk run: all done, or how many of them. Guard:
 *  plans.test.ts ("tripPlanBulkDone"). */
export function tripPlanBulkDone(
  kind: "delete" | "leave" | "archive" | "unarchive",
  done: number,
  total: number,
): string {
  if (done === total)
    return {
      delete: plural(total, "Deleted # plan.", "Deleted # plans."),
      leave: plural(total, "Left # plan.", "Left # plans."),
      archive: plural(total, "Archived # plan.", "Archived # plans."),
      unarchive: plural(total, "Brought back # plan.", "Brought back # plans."),
    }[kind];
  // `{0}` is the count done and `#` the total.
  return {
    delete: plural(
      total,
      "Deleted {0} of # plan. The rest didn't go through.",
      "Deleted {0} of # plans. The rest didn't go through.",
      done,
    ),
    leave: plural(
      total,
      "Left {0} of # plan. The rest didn't go through.",
      "Left {0} of # plans. The rest didn't go through.",
      done,
    ),
    archive: plural(
      total,
      "Archived {0} of # plan. The rest didn't go through.",
      "Archived {0} of # plans. The rest didn't go through.",
      done,
    ),
    unarchive: plural(
      total,
      "Brought back {0} of # plan. The rest didn't go through.",
      "Brought back {0} of # plans. The rest didn't go through.",
      done,
    ),
  }[kind];
}

/** "20 forms at most": why an Add control is disabled at its cap. */
export const tripPlanAtMost = (max: number, noun: string): string =>
  t`${max} ${noun} at most`;

/** A row's ⋯ label: "Actions for Arethusa Canyon". */
export const tripPlanActionsFor = (name: string): string =>
  t`Actions for ${name}`;
