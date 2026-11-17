import { LEADERBOARD, navLabel, t } from "@logjam/shared";

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
  MapView: t`Map`,
  PlaceList: navLabel("places"),
  TripList: navLabel("logs"),
  SavedHome: navLabel("saved"),
  MoreHome: t`More`,
  Inbox: navLabel("inbox"),
  Plans: navLabel("plans"),
  Plan: param("name"),
  Friends: navLabel("friends"),
  FriendShares: param("username"),
  Leaderboard: LEADERBOARD.title,
  Account: navLabel("account"),
  Settings: navLabel("settings"),
  SyncIssues: navLabel("syncIssues"),
  TripStats: t`Stats`,
  MapPlaceDetail: t`Place`,
  PlaceDetail: t`Place`,
  TripPlaceDetail: t`Place`,
  MorePlaceDetail: t`Place`,
  MapTripDetail: t`Trip`,
  PlaceTripDetail: t`Trip`,
  TripDetail: t`Trip`,
  MoreTripDetail: t`Trip`,
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
  return name ?? t`Back`;
}
