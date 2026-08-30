// What a notification tap does, decided without the navigator.
//
// Its own module, free of React Native imports, so it can be unit-tested:
// AppShell pulls in the RN runtime and vitest cannot parse React Native's Flow
// sources. Same split, and the same reason, as `sharing/shareRowSubtitle.ts`.

/** Where a tapped notification sends the user — or that it sends them nowhere. */
export type NotificationTapTarget =
  | { kind: "blocked" }
  | { kind: "canyon"; canyonId: string }
  | { kind: "inbox" };

/**
 * ORDER IS THE POINT (MAPP-009). A route being drawn owns the map's taps and
 * has no home anywhere else, so the draft beats the payload: a notification tap
 * is only a second way to leave the map, and it is refused the same way the tab
 * bar refuses one — answered with the Alert rather than silently ignored.
 * Without that precedence a push landed the user in CanyonDetail with the pen
 * still armed and nothing on screen saying so.
 *
 * Below the draft it is just the payload: a canyonId goes to that canyon, and
 * everything else — no id, an id that is not a string, a payload that is not an
 * object — falls back to the inbox, where every notification is listed anyway.
 *
 * That fallback carries the two ACTIONABLE kinds, and it is now the right
 * destination rather than merely a safe one: a friend request and a file send
 * are answered inline on their inbox row, so the tap lands the user exactly
 * where the accept/decline is. Neither has a screen of its own to deep-link to.
 */
export function notificationTapTarget(args: {
  data: unknown;
  routeEditing: boolean;
}): NotificationTapTarget {
  if (args.routeEditing) return { kind: "blocked" };
  const canyonId = (args.data as { canyonId?: unknown } | null | undefined)?.canyonId;
  if (typeof canyonId === "string") return { kind: "canyon", canyonId };
  return { kind: "inbox" };
}
