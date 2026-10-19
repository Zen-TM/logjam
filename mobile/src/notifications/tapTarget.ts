// What a notification tap does, decided without the navigator.
//
// Its own module, free of React Native imports, so it can be unit-tested:
// AppShell pulls in the RN runtime and vitest cannot parse React Native's Flow
// sources. Same split, and the same reason, as `sharing/shareRowSubtitle.ts`.

/** Where a tapped notification sends the user — or that it sends them nowhere. */
export type NotificationTapTarget =
  | { kind: "blocked" }
  | { kind: "place"; placeId: string }
  | { kind: "plan"; planId: string }
  | { kind: "plans" }
  | { kind: "inbox" };

/** The plan pushes about a plan the recipient is in, so it opens. */
const PLAN_OPENING_TYPES = new Set([
  "plan_join_request",
  "plan_join_approved",
  "plan_member_joined",
]);

/**
 * ORDER IS THE POINT. Guard: `src/notifications/tapTarget.test.ts`. A route
 * being drawn owns the map's taps and has no home anywhere else, so the draft
 * beats the payload: a notification tap is only a second way to leave the map,
 * and it is refused the same way the tab bar refuses one — answered with the
 * Alert rather than silently ignored. Without that precedence a push lands the
 * user in PlaceDetail with the pen still armed and nothing on screen saying so.
 *
 * Below the draft it is just the payload: a placeId goes to that place, and
 * everything else — no id, an id that is not a string, a payload that is not an
 * object — falls back to the inbox, where every notification is listed anyway.
 *
 * That fallback carries the two ACTIONABLE kinds, and is the right destination:
 * a friend request and a file send are answered inline on their inbox row, so
 * the tap lands the user exactly where the accept/decline is. Neither has a
 * screen of its own to deep-link to.
 */
export function notificationTapTarget(args: {
  data: unknown;
  routeEditing: boolean;
}): NotificationTapTarget {
  if (args.routeEditing) return { kind: "blocked" };
  const placeId = (args.data as { placeId?: unknown } | null | undefined)
    ?.placeId;
  if (typeof placeId === "string") return { kind: "place", placeId };
  // A plan push opens that plan, except an invite, which waits on the Plans
  // list, and a plan the recipient lost, which only the inbox still names.
  const { type, planId } = (args.data ?? {}) as {
    type?: unknown;
    planId?: unknown;
  };
  if (type === "plan_invited") return { kind: "plans" };
  if (
    typeof type === "string" &&
    PLAN_OPENING_TYPES.has(type) &&
    typeof planId === "string"
  )
    return { kind: "plan", planId };
  return { kind: "inbox" };
}
