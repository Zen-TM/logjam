// The friend invite link: its shape, and how each client reads one back.
//
// Shared because Logjam Web and Logjam GPS both mint the link and Logjam Web
// reads it, and a link one writes that the other cannot parse is a dead link
// in someone's messages.
//
// The token rides in the URL FRAGMENT, on the site root. A fragment is never
// sent to a server, so the token reaches no access log, proxy or Referer
// header; the only request that carries it is the signed-in POST that spends
// it. Guard: friendInvite.test.ts.

/** How long a link works, in days. The copy and the API both read this. */
export const FRIEND_INVITE_TTL_DAYS = 7;

/** 32 random bytes, base64url: what `mintFriendInviteToken` (api) produces. */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

const FRAGMENT_KEY = "invite";

export function isFriendInviteToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN.test(value);
}

/** `origin` is Logjam Web's, e.g. `https://example.test`. */
export function friendInviteUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/#${FRAGMENT_KEY}=${token}`;
}

/**
 * The token in a location hash (`#invite=…`), or null. Anything that is not
 * exactly a token is null, so a mangled link asks the server nothing.
 */
export function friendInviteTokenFromHash(hash: string): string | null {
  const value = new URLSearchParams(hash.replace(/^#/, "")).get(FRAGMENT_KEY);
  return isFriendInviteToken(value) ? value : null;
}
