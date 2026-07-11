import { ApiError } from "../../../errors/ApiError";

// A friend-request notification's Accept/Decline action can fail with a
// 400/409 when the underlying request was already resolved elsewhere (e.g.
// accepted or declined from the Friends panel in another tab, or a stale
// notification left over after that). That's not a transient/retryable
// failure — the action is permanently dead, so the notification should stay
// hidden rather than pop back up with live buttons that will just fail again
// (NOTIF-1). Any other error (network blip, 5xx, unexpected 403) is treated
// as retryable and the notification is restored to view.
export function isResolvedElsewhereError(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 400 || err.status === 409);
}
