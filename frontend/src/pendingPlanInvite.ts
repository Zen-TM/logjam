// A plan invite link opened in this tab, held until its opener is signed in:
// the twin of `pendingFriendInvite.ts`, for `#plan-invite=`. Out of the
// address bar at once, kept in sessionStorage across the sign-up it usually
// waits for, and nothing asked of the server until then.
import { planInviteTokenFromHash } from "@logjam/shared";

const KEY = "pendingPlanInvite";

export function capturePlanInvite(): void {
  const token = planInviteTokenFromHash(window.location.hash);
  if (!token) return;
  sessionStorage.setItem(KEY, token);
  window.history.replaceState(
    {},
    "",
    window.location.pathname + window.location.search,
  );
}

export function pendingPlanInvite(): string | null {
  return sessionStorage.getItem(KEY);
}

export function clearPendingPlanInvite(): void {
  sessionStorage.removeItem(KEY);
}
