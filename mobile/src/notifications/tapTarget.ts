// What a notification tap does, decided without the navigator.
//
// Its own module, free of React Native imports, so it can be unit-tested:
// AppShell pulls in the RN runtime and vitest cannot parse React Native's Flow
// sources. Same split, and the same reason, as `sharing/shareRowSubtitle.ts`.

import {
  notificationPlanTarget,
  TRIP_PLANS_LIST,
  type TNotification,
} from "@logjam/shared";

import type { SavedCategory } from "../saved/savedKeys";
import { notificationDestination } from "./notificationDestination";

/** Where a tapped notification sends the user — or that it sends them nowhere. */
export type NotificationTapTarget =
  | { kind: "blocked" }
  | { kind: "place"; placeId: string }
  | { kind: "plan"; planId: string; view?: "people"; invited?: boolean }
  | { kind: "announcement"; announcementId: string }
  | { kind: "friends" }
  | { kind: "saved"; filter: SavedCategory; highlightKey: string | null }
  | { kind: "inbox" };

/**
 * ORDER IS THE POINT. Guard: `src/notifications/tapTarget.test.ts`. A route
 * being drawn owns the map's taps and has no home anywhere else, so the draft
 * beats the payload: a notification tap is only a second way to leave the map,
 * and it is refused the same way the tab bar refuses one — answered with the
 * Alert rather than silently ignored. Without that precedence a push lands the
 * user in PlaceDetail with the pen still armed and nothing on screen saying so.
 *
 * Below the draft it is just the payload: a placeId goes to that place, an
 * announcementId to the inbox with that message open, a plan push to its plan,
 * and a friend, shared-item or finished-topo push to the same screen its Inbox
 * row opens (`notificationDestination`, so the two cannot drift). Everything
 * else — no id, an id that is not a string, a payload that is not an object, a
 * failure, a quota, a file send still waiting to be answered — falls back to
 * the inbox, where every notification is listed anyway and a file send is
 * answered inline.
 */
export function notificationTapTarget(args: {
  data: unknown;
  routeEditing: boolean;
}): NotificationTapTarget {
  if (args.routeEditing) return { kind: "blocked" };
  const data = args.data as
    | { placeId?: unknown; announcementId?: unknown }
    | null
    | undefined;
  const placeId = data?.placeId;
  if (typeof placeId === "string") return { kind: "place", placeId };
  // A plan push opens where Logjam Web opens its inbox row
  // (`notificationPlanTarget`): an invite as its preview, a join request on
  // People. A plan the recipient lost is only named in the inbox.
  const { type } = (args.data ?? {}) as { type?: unknown };
  const plan =
    typeof type === "string"
      ? notificationPlanTarget({
          type,
          payload: args.data ?? {},
        } as TNotification)
      : null;
  if (plan)
    return {
      kind: "plan",
      planId: plan.planId,
      view: plan.view,
      invited: plan.invited,
    };
  // The push carries `type` plus the same opaque ids the row's payload holds,
  // so the row's own mapping reads it as it is. A push has no
  // `fileSendStatus`, so a file send stays on the inbox, where it is answered.
  const destination =
    typeof type === "string"
      ? notificationDestination({
          id: "",
          type,
          payload: (args.data ?? {}) as Record<string, unknown>,
          read: false,
          createdAt: "",
        })
      : null;
  if (destination?.tab === "friends") return { kind: "friends" };
  if (destination?.tab === "saved") {
    return {
      kind: "saved",
      filter: destination.filter,
      highlightKey: destination.highlightKey,
    };
  }
  const announcementId = data?.announcementId;
  if (typeof announcementId === "string" && announcementId.length > 0) {
    return { kind: "announcement", announcementId };
  }
  return { kind: "inbox" };
}

/** One `navigate(name, params)` on the TAB navigator. */
export type RouteCall = { name: string; params?: object };

/** What an Inbox row's "View in" and a tapped push both open. */
export type DestinationTarget =
  | { tab: "friends" }
  | { tab: "saved"; filter: SavedCategory; highlightKey: string | null };

/**
 * The one route a destination is opened with, from the Inbox row and from a
 * push alike. Always through the More tab's own stack for Friends: from the
 * Inbox that pushes Friends on top of it, so Back returns to the inbox; from a
 * cold start it is the stack's only screen. Guard: `tapTarget.test.ts`. The
 * navigator's ref is typed `never`, so a misspelt screen name does not fail
 * the type-check; that test does.
 */
export function destinationCall(
  d: DestinationTarget,
  nonce: number,
): RouteCall {
  if (d.tab === "friends") {
    return { name: "More", params: { screen: "Friends" } };
  }
  return {
    name: "Saved",
    params: {
      screen: "SavedHome",
      params: {
        filter: d.filter,
        nonce,
        ...(d.highlightKey ? { highlightKey: d.highlightKey } : {}),
      },
    },
  };
}

/** The route a tap opens; `blocked` has none (the shell answers it). */
export function tapTargetCall(
  target: Exclude<NotificationTapTarget, { kind: "blocked" }>,
  nonce: number,
): RouteCall {
  switch (target.kind) {
    case "place":
      return {
        name: "Places",
        params: {
          screen: "PlaceDetail",
          params: { placeId: target.placeId, name: "Place" },
        },
      };
    case "plan":
      return {
        name: "More",
        params: {
          screen: "Plan",
          params: {
            planId: target.planId,
            name: TRIP_PLANS_LIST.title,
            view: target.view,
            invited: target.invited,
          },
        },
      };
    case "announcement":
      return {
        name: "More",
        params: {
          screen: "Inbox",
          params: {
            openAnnouncement: {
              announcementId: target.announcementId,
              nonce,
            },
          },
        },
      };
    case "friends":
      return destinationCall({ tab: "friends" }, nonce);
    case "saved":
      return destinationCall(
        {
          tab: "saved",
          filter: target.filter,
          highlightKey: target.highlightKey,
        },
        nonce,
      );
    case "inbox":
      return { name: "More", params: { screen: "Inbox" } };
  }
}
