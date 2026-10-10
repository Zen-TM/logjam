// A friend invite link opened in this tab, held until its opener is signed in.
//
// Taken out of the address bar at once, so the token is not left in history,
// a bookmark or a screenshot, and kept in sessionStorage so it outlives the
// sign-in or sign-up it usually has to wait for. Nothing is asked of the
// server until then: a signed-out visitor learns only that there is an invite.
import { friendInviteTokenFromHash } from "@logjam/shared";

const KEY = "pendingFriendInvite";

export function captureFriendInvite(): void {
  const token = friendInviteTokenFromHash(window.location.hash);
  if (!token) return;
  sessionStorage.setItem(KEY, token);
  window.history.replaceState(
    {},
    "",
    window.location.pathname + window.location.search,
  );
}

export function pendingFriendInvite(): string | null {
  return sessionStorage.getItem(KEY);
}

export function clearPendingFriendInvite(): void {
  sessionStorage.removeItem(KEY);
}
