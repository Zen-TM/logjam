// Where a user can go: the destinations both clients draw, once. Logjam Web's
// rail, its narrow tabs and its More menu, and Logjam GPS's tab bar and More
// hub, are each this list filtered for one client. `nav.test.ts` holds the
// order; the clients' own tests hold that they draw it.
//
// Not here: the Map. It is a tab on Logjam GPS and what a page closes back to
// on Logjam Web, and it is first on both.
import type { IconIdea } from "../icons.js";
import type { ContractPlatform } from "./types.js";

type NavDeclaration = {
  /** Logjam Web's panel id and Logjam GPS's route name, lower-cased. */
  id: string;
  label: string;
  icon: IconIdea;
  /** `page` is the rail's top group, `personal` the one below its spacer. */
  group: "page" | "personal";
  /** A tab on narrow Logjam Web and on Logjam GPS; the rest are in More. */
  tab?: true;
  /** What its badge counts, in its accessible name: "Plans, 1 invited". */
  badgeNoun?: string;
  /** Only one client has it; `reason` says what about the medium rules it out
   *  on the other. */
  on?: ContractPlatform;
  reason?: string;
};

/**
 * In order: a tab bar reads it left to right, More top to bottom. Logjam Web's
 * desktop rail takes the `page` group, a spacer, then the `personal` group.
 */
export const NAV = [
  { id: "places", label: "Places", icon: "place", group: "page", tab: true },
  // The tab's word. The panel and route ids stay `logs`.
  { id: "logs", label: "Trips", icon: "trip", group: "page", tab: true },
  {
    id: "ways",
    label: "Ways",
    // The umbrella for routes, recorded tracks and imports. "Routes" would name
    // one of its own three kinds.
    icon: "route",
    group: "page",
    tab: true,
    on: "web",
    reason:
      "Logjam GPS keeps its lines on Saved, beside the offline maps, sharpened areas and GeoPDFs a phone also manages.",
  },
  {
    id: "saved",
    label: "Saved",
    icon: "saved",
    group: "page",
    tab: true,
    on: "gps",
    reason:
      "A browser keeps no offline copies to manage; its lines are the Ways page.",
  },
  { id: "inbox", label: "Inbox", icon: "notifications", group: "personal" },
  // An invite waiting on the user is what its badge counts. A page on a wide
  // screen, in More on a narrow one.
  {
    id: "plans",
    label: "Plans",
    icon: "plan",
    group: "page",
    badgeNoun: "invited",
  },
  { id: "friends", label: "Friends", icon: "friends", group: "page" },
  {
    id: "syncIssues",
    label: "Sync issues",
    icon: "warning",
    group: "personal",
    on: "gps",
    reason:
      "Logjam Web writes straight to the server, so nothing waits to sync there.",
  },
  { id: "settings", label: "Settings", icon: "settings", group: "personal" },
  { id: "account", label: "Account", icon: "account", group: "personal" },
] as const satisfies readonly NavDeclaration[];

export type NavId = (typeof NAV)[number]["id"];

/** The ids one client has: the unmarked ones plus its own. */
export type NavIdOn<P extends ContractPlatform> = Exclude<
  (typeof NAV)[number],
  { on: Exclude<ContractPlatform, P> }
>["id"];

export type NavEntry = {
  id: NavId;
  label: string;
  icon: IconIdea;
  group: "page" | "personal";
  tab?: true;
  badgeNoun?: string;
};

/** A client's destinations, in order. */
export function navFor<P extends ContractPlatform>(
  platform: P,
): (NavEntry & { id: NavIdOn<P> })[] {
  return (NAV as readonly (NavEntry & { on?: ContractPlatform })[]).filter(
    (entry) => entry.on == null || entry.on === platform,
  ) as (NavEntry & { id: NavIdOn<P> })[];
}

/** The word for one destination. */
export function navLabel(id: NavId): string {
  return NAV.find((entry) => entry.id === id)!.label;
}

/** "Inbox, 3 unread": a badge is hidden from assistive tech, so its count joins
 *  the name. A zero is no badge. */
export function labelWithBadge(
  label: string,
  count: number,
  noun = "unread",
): string {
  return count > 0 ? `${label}, ${count} ${noun}` : label;
}
