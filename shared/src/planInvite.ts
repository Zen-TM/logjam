// The plan invite link: its shape, and how Logjam Web reads one back. The
// token is the friend invite's (`isFriendInviteToken`), in the fragment for
// the same reason: no server, log or Referer ever sees it, and the only
// request that carries it is the signed-in POST that previews or redeems it.
// A different fragment key keeps the two links apart, since what each grants
// differs. Guard: planInvite.test.ts.
import { isFriendInviteToken } from "./friendInvite.js";

const FRAGMENT_KEY = "plan-invite";

/** `origin` is Logjam Web's, e.g. `https://example.test`. */
export function planInviteUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/#${FRAGMENT_KEY}=${token}`;
}

/** The token in a location hash (`#plan-invite=…`), or null for anything else. */
export function planInviteTokenFromHash(hash: string): string | null {
  const value = new URLSearchParams(hash.replace(/^#/, "")).get(FRAGMENT_KEY);
  return isFriendInviteToken(value) ? value : null;
}
