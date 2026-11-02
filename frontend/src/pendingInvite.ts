// An invite link opened in this tab, held until its opener is signed in: a
// friend's (`#invite=`) or a plan's (`#plan-invite=`).
//
// Taken out of the address bar at once, so the token is not left in history,
// a bookmark or a screenshot, and kept in sessionStorage so it outlives the
// sign-in or sign-up it usually has to wait for. Nothing is asked of the
// server until then: a signed-out visitor learns only that there is an invite.
import {
  friendInviteTokenFromHash,
  planInviteTokenFromHash,
} from "@logjam/shared";

function pendingInvite(key: string, parse: (hash: string) => string | null) {
  return {
    capture(): void {
      const token = parse(window.location.hash);
      if (!token) return;
      sessionStorage.setItem(key, token);
      window.history.replaceState(
        {},
        "",
        window.location.pathname + window.location.search,
      );
    },
    pending: (): string | null => sessionStorage.getItem(key),
    clear: (): void => sessionStorage.removeItem(key),
  };
}

export const friendInvite = pendingInvite(
  "pendingFriendInvite",
  friendInviteTokenFromHash,
);
export const planInvite = pendingInvite(
  "pendingPlanInvite",
  planInviteTokenFromHash,
);
