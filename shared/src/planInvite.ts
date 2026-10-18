// The plan invite link: the friend invite's token and fragment design
// (friendInvite.ts), under its own key so the two links stay apart, since
// what each grants differs. Guard: planInvite.test.ts.
import { inviteTokenFromHash, inviteUrl } from "./friendInvite.js";

const FRAGMENT_KEY = "plan-invite";

/** `origin` is Logjam Web's, e.g. `https://example.test`. */
export function planInviteUrl(origin: string, token: string): string {
  return inviteUrl(FRAGMENT_KEY, origin, token);
}

/** The token in `#plan-invite=…`, or null for anything else. */
export function planInviteTokenFromHash(hash: string): string | null {
  return inviteTokenFromHash(FRAGMENT_KEY, hash);
}
