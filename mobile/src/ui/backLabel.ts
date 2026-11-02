import { LEADERBOARD, navLabel } from "@logjam/shared";

type StackRoute = { key: string; name: string; params?: object | undefined };
type Param = (params: Record<string, unknown>) => string | undefined;

// What each route is called where a screen names it as the way back. The tab
// roots take their tab's name; a route that is one of many (a plan, a friend)
// takes its own name from its params.
const param =
  (key: string): Param =>
  (p) =>
    typeof p[key] === "string" ? (p[key] as string) : undefined;

const LABELS: Record<string, string | Param> = {
  MapView: "Map",
  PlaceList: navLabel("places"),
  TripList: navLabel("logs"),
  SavedHome: navLabel("saved"),
  MoreHome: "More",
  Inbox: navLabel("inbox"),
  Plans: navLabel("plans"),
  Plan: param("name"),
  Friends: navLabel("friends"),
  FriendShares: param("username"),
  Leaderboard: LEADERBOARD.title,
  Account: navLabel("account"),
  SyncIssues: navLabel("syncIssues"),
  TripStats: "Stats",
  MapPlaceDetail: "Place",
  PlaceDetail: "Place",
  TripPlaceDetail: "Place",
  MorePlaceDetail: "Place",
  MapTripDetail: "Trip",
  PlaceTripDetail: "Trip",
  TripDetail: "Trip",
  MoreTripDetail: "Trip",
};

/**
 * The name of the screen under `routeKey` in its stack: where Back goes. It
 * reads the navigator's own history, so a screen reached from two places
 * (Plans from More and from a notification) names whichever it was pushed
 * from. Guard: `backLabel.test.ts`.
 */
export function backLabelOf(
  state: { routes: readonly StackRoute[] },
  routeKey: string,
): string {
  const i = state.routes.findIndex((r) => r.key === routeKey);
  const prev = state.routes[i - 1];
  const label = prev && LABELS[prev.name];
  const name =
    typeof label === "function"
      ? label((prev.params ?? {}) as Record<string, unknown>)
      : label;
  return name ?? "Back";
}
