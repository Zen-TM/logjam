// Guards for the session (ADR 0041, 0006, useAuth.ts header). Each names the
// mutation that turns it red.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const config = {
  authMode: "oidc",
  oidcIssuer:
    "https://cognito-idp.ap-southeast-2.amazonaws.com/ap-southeast-2_AbC123",
  oidcClientId: "client",
};
const secure = new Map<string, string>();
const setItemAsync = vi.fn(async (k: string, v: string) => {
  secure.set(k, v);
});
const fetchMock = vi.fn();
const prompt = vi.fn();
const openAuthSession = vi.fn();
const reachable = vi.fn();

vi.stubGlobal("fetch", fetchMock);
vi.mock("../config", () => ({ config }));
vi.mock("expo-secure-store", () => ({
  getItemAsync: async (k: string) => secure.get(k) ?? null,
  setItemAsync,
  deleteItemAsync: async (k: string) => {
    secure.delete(k);
  },
}));
vi.mock("expo-constants", () => ({
  default: { expoConfig: { scheme: "logjam" } },
}));
vi.mock("expo-auth-session", () => ({
  ResponseType: { Code: "code" },
  AuthRequest: class {
    codeVerifier = "verifier";
    promptAsync = prompt;
  },
}));
vi.mock("expo-web-browser", () => ({
  openAuthSessionAsync: (...a: unknown[]) => openAuthSession(...a),
}));
vi.mock("../map/connectivity", () => ({ isReachableNow: () => reachable() }));

const {
  SESSION_TIMEOUT_MS,
  SessionTimeoutError,
  assertCanSignOutEverywhere,
  endProviderSession,
  getSession,
  identityFromIdToken,
  signInWithBrowser,
  signOutEverywhereAtProvider,
  signOutLocally,
} = await import("./oidcSession");
const { classifySessionError } = await import("./sessionErrors");

function jwt(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64(claims)}.sig`;
}
const inSeconds = (s: number) => Math.floor(Date.now() / 1000) + s;
const FRESH = () =>
  jwt({ sub: "s1", email: "a@example.com", exp: inSeconds(3600) });
const STALE = () => jwt({ sub: "s1", exp: inSeconds(30) });
const TOKEN_ENDPOINT = "https://auth.test/oauth2/token";

function store(idToken: string, extra: Record<string, unknown> = {}) {
  secure.set(
    "logjam_oidc_session",
    JSON.stringify({
      idToken,
      accessToken: "old-access",
      refreshToken: "refresh-1",
      tokenEndpoint: TOKEN_ENDPOINT,
      revocationEndpoint: "https://auth.test/oauth2/revoke",
      endSessionEndpoint: "https://auth.test/logout",
      ...extra,
    }),
  );
}
const stored = () => JSON.parse(secure.get("logjam_oidc_session") ?? "null");

function answer(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}
const refreshed = () =>
  answer(200, {
    id_token: FRESH(),
    access_token: "new-access",
    expires_in: 3600,
  });

beforeEach(() => {
  secure.clear();
  for (const m of [fetchMock, setItemAsync, prompt, openAuthSession, reachable])
    m.mockClear();
  fetchMock.mockReset();
  reachable.mockResolvedValue(true);
  openAuthSession.mockResolvedValue({ type: "success" });
  config.authMode = "oidc";
});
afterEach(() => {
  vi.useRealTimers();
});

describe("a stored session", () => {
  // Mutation: read expiry from anywhere but the ID token's `exp`, or call the
  // network before looking at it.
  it("works with no network while the ID token is valid", async () => {
    store(FRESH());
    fetchMock.mockRejectedValue(new TypeError("Network request failed"));
    const session = await getSession();
    expect(session?.accessToken).toBe("old-access");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Mutation: drop the 60 s margin from isFresh.
  it("refreshes a token within a minute of expiring", async () => {
    store(STALE());
    fetchMock.mockResolvedValue(refreshed());
    const session = await getSession();
    expect(session?.accessToken).toBe("new-access");
  });

  it("is null with no session, and with a record it cannot read", async () => {
    expect(await getSession()).toBeNull();
    secure.set("logjam_oidc_session", "{not json");
    expect(await getSession()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("refresh", () => {
  // Mutation: drop the `refreshing` check in `refresh`.
  it("shares one flight between concurrent callers", async () => {
    store(STALE());
    let release!: (r: unknown) => void;
    fetchMock.mockReturnValue(new Promise((r) => (release = r)));
    const calls = [
      getSession(),
      getSession(),
      getSession({ forceRefresh: true }),
    ];
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    release(refreshed());
    const results = await Promise.all(calls);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new Set(results.map((r) => r?.accessToken))).toEqual(
      new Set(["new-access"]),
    );
  });

  // Mutation: store `tokens.refresh_token` without the `?? stored.refreshToken`
  // fallback (Cognito sends none).
  it("keeps the old refresh token when none comes back", async () => {
    store(STALE());
    fetchMock.mockResolvedValue(refreshed());
    await getSession();
    expect(stored().refreshToken).toBe("refresh-1");
    expect(stored().accessToken).toBe("new-access");
    const [, init] = fetchMock.mock.calls[0];
    expect(init.body).toContain("grant_type=refresh_token");
    expect(init.body).toContain("refresh_token=refresh-1");
    expect(init.body).not.toContain("client_secret");
  });

  it("takes a rotated refresh token when the provider sends one", async () => {
    store(STALE());
    fetchMock.mockResolvedValue(
      answer(200, {
        id_token: FRESH(),
        access_token: "a",
        refresh_token: "refresh-2",
      }),
    );
    await getSession();
    expect(stored().refreshToken).toBe("refresh-2");
  });

  // Mutation: treat any 400 (or a missing check on `error`) as rejected, or
  // stop clearing the tokens on a rejection.
  it("rejects on HTTP 400 invalid_grant, and drops the tokens", async () => {
    store(STALE());
    fetchMock.mockResolvedValue(answer(400, { error: "invalid_grant" }));
    const err = await getSession().catch((e: unknown) => e);
    expect(classifySessionError(err)).toBe("rejected");
    expect(stored()).toBeNull();
  });

  it("is transient, and keeps the tokens, for every other failure", async () => {
    const failures: [string, () => unknown][] = [
      [
        "network error",
        () => Promise.reject(new TypeError("Network request failed")),
      ],
      ["400 other", () => answer(400, { error: "invalid_request" })],
      ["401", () => answer(401, { error: "invalid_client" })],
      ["500", () => answer(500, {})],
      [
        "503 html",
        () => ({
          ok: false,
          status: 503,
          json: async () => {
            throw new Error("html");
          },
        }),
      ],
      ["200 without tokens", () => answer(200, { token_type: "Bearer" })],
      [
        "200 not json",
        () => ({
          ok: true,
          status: 200,
          json: async () => {
            throw new Error("x");
          },
        }),
      ],
    ];
    for (const [name, respond] of failures) {
      store(STALE());
      fetchMock.mockReset();
      fetchMock.mockImplementation(async () => respond());
      const err = await getSession().catch((e: unknown) => e);
      expect(classifySessionError(err), name).toBe("transient");
      expect(stored(), name).not.toBeNull();
    }
  });

  // Mutation: remove the `within` race or its timer.
  it("settles as a timeout when the provider never answers, keeping the tokens", async () => {
    vi.useFakeTimers();
    store(STALE());
    fetchMock.mockReturnValue(new Promise(() => {}));
    const pending = getSession();
    const settled = vi.fn();
    void pending.catch(settled);
    await vi.advanceTimersByTimeAsync(SESSION_TIMEOUT_MS - 1);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    const err = await pending.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SessionTimeoutError);
    expect(classifySessionError(err)).toBe("transient");
    expect(stored()).not.toBeNull();
  });

  // Mutation: clear unconditionally in the REFRESH_REJECTED branch and the old
  // session's late rejection deletes the tokens of the one signed in since.
  it("does not delete a newer session when the old one's refresh is rejected", async () => {
    store(STALE());
    let release!: (r: unknown) => void;
    fetchMock.mockReturnValue(new Promise((r) => (release = r)));
    const pending = getSession().catch((e: unknown) => e);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    store(FRESH(), { refreshToken: "refresh-2" });
    release(answer(400, { error: "invalid_grant" }));
    await pending;
    expect(stored()).not.toBeNull();
  });

  // Mutation: remove the `current?.refreshToken` re-read before the write.
  it("does not bring a session back that was signed out while the refresh ran", async () => {
    store(STALE());
    let release!: (r: unknown) => void;
    fetchMock.mockReturnValue(new Promise((r) => (release = r)));
    const pending = getSession();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await signOutLocally();
    release(refreshed());
    expect(await pending).toBeNull();
    expect(stored()).toBeNull();
  });
});

describe("tokens at rest", () => {
  // Mutation: store the session anywhere but secureKeyValueStorage (the
  // equivalent of the old amplifyConfig.test.ts).
  it("go to SecureStore, and a sign-in is the only way in", async () => {
    store(STALE());
    fetchMock.mockResolvedValue(refreshed());
    await getSession();
    expect(setItemAsync).toHaveBeenCalled();
    const kept = [...secure.values()].join("");
    expect(kept).toContain("new-access");
  });

  it("are never written by a module that reaches AsyncStorage or the console", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(
      new URL("./oidcSession.ts", import.meta.url),
      "utf8",
    );
    expect(src).not.toMatch(/async-storage/i);
    expect(src).not.toMatch(/console\.(log|info|debug)/);
  });
});

describe("signInWithBrowser", () => {
  beforeEach(() => {
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith("openid-configuration")
        ? answer(200, {
            authorization_endpoint: "https://auth.test/oauth2/authorize",
            token_endpoint: TOKEN_ENDPOINT,
            revocation_endpoint: "https://auth.test/oauth2/revoke",
            end_session_endpoint: "https://auth.test/logout",
          })
        : answer(200, {
            id_token: FRESH(),
            access_token: "a1",
            refresh_token: "r1",
          }),
    );
  });

  it("stores the tokens and the endpoints a refresh and a sign-out need", async () => {
    prompt.mockResolvedValue({ type: "success", params: { code: "c" } });
    const result = await signInWithBrowser();
    expect(result.type).toBe("success");
    expect(stored()).toMatchObject({
      accessToken: "a1",
      refreshToken: "r1",
      tokenEndpoint: TOKEN_ENDPOINT,
      endSessionEndpoint: "https://auth.test/logout",
    });
    const exchange = fetchMock.mock.calls.at(-1)![1].body as string;
    expect(exchange).toContain("code_verifier=verifier");
    expect(exchange).toContain("redirect_uri=logjam%3A%2F%2Fauth");
  });

  // Mutation: store or throw for a non-success prompt.
  it.each(["cancel", "dismiss", "locked"])(
    "changes nothing when the sheet ends as %s",
    async (type) => {
      store(FRESH());
      const before = secure.get("logjam_oidc_session");
      prompt.mockResolvedValue({ type });
      await expect(signInWithBrowser()).resolves.toEqual({ type: "cancel" });
      expect(secure.get("logjam_oidc_session")).toBe(before);
      expect(fetchMock).toHaveBeenCalledTimes(1); // discovery only
    },
  );

  it("throws the provider's error, storing nothing", async () => {
    prompt.mockResolvedValue({
      type: "error",
      error: new Error("access_denied"),
    });
    await expect(signInWithBrowser()).rejects.toThrow("access_denied");
    expect(stored()).toBeNull();
  });
});

describe("sign out", () => {
  // Mutation: gate signOutLocally on the network, or run revoke before it.
  it("completes offline: tokens go, nothing is sent, no browser opens", async () => {
    store(FRESH());
    reachable.mockResolvedValue(false);
    const old = await signOutLocally();
    await endProviderSession(old);
    expect(stored()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(openAuthSession).not.toHaveBeenCalled();
  });

  it("completes when the phone says online but nothing answers", async () => {
    vi.useFakeTimers();
    store(FRESH());
    fetchMock.mockReturnValue(new Promise(() => {}));
    openAuthSession.mockRejectedValue(new Error("no browser"));
    const old = await signOutLocally();
    const done = endProviderSession(old);
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(done).resolves.toBeUndefined();
    expect(stored()).toBeNull();
  });

  it("online, revokes the refresh token and ends the provider's session", async () => {
    store(FRESH());
    fetchMock.mockResolvedValue(answer(200, {}));
    const old = await signOutLocally();
    await endProviderSession(old);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://auth.test/oauth2/revoke");
    expect(init.body).toContain("token=refresh-1");
    const [endUrl, returnUrl] = openAuthSession.mock.calls[0];
    expect(endUrl).toContain("https://auth.test/logout?");
    expect(endUrl).toContain("client_id=client");
    expect(endUrl).toContain("logout_uri=logjam%3A%2F%2Fauth");
    expect(returnUrl).toBe("logjam://auth");
  });
});

describe("sign out everywhere", () => {
  // Mutation: drop `forceRefresh`, or the `!session` check.
  it("forces a refresh first, and throws when there is none to be had", async () => {
    store(FRESH());
    fetchMock.mockResolvedValue(refreshed());
    await assertCanSignOutEverywhere();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    secure.clear();
    await expect(assertCanSignOutEverywhere()).rejects.toThrow();
  });

  it("throws, clearing nothing, when the refresh cannot reach the provider", async () => {
    store(FRESH());
    fetchMock.mockRejectedValue(new TypeError("offline"));
    await expect(assertCanSignOutEverywhere()).rejects.toThrow("offline");
    expect(stored()).not.toBeNull();
  });

  // Mutation: catch the error in signOutEverywhereAtProvider.
  it("does not swallow a failed GlobalSignOut", async () => {
    store(FRESH());
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ __type: "NotAuthorizedException", message: "x" }),
    });
    await expect(signOutEverywhereAtProvider()).rejects.toMatchObject({
      name: "NotAuthorizedException",
    });
    expect(fetchMock.mock.calls[0][1].headers["X-Amz-Target"]).toBe(
      "AWSCognitoIdentityProviderService.GlobalSignOut",
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      AccessToken: "old-access",
    });
  });

  it("settles when GlobalSignOut never answers", async () => {
    vi.useFakeTimers();
    store(FRESH());
    fetchMock.mockReturnValue(new Promise(() => {}));
    const pending = signOutEverywhereAtProvider();
    void pending.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(SESSION_TIMEOUT_MS + 1);
    await expect(pending).rejects.toBeInstanceOf(SessionTimeoutError);
  });
});

describe("identityFromIdToken", () => {
  // Mutation: return a sub-less identity, or let an empty sub through.
  it("is null without a sub, so the sign-in is cancelled", () => {
    expect(identityFromIdToken(jwt({ email: "a@example.com" }))).toBeNull();
    expect(identityFromIdToken(jwt({ sub: "" }))).toBeNull();
    expect(identityFromIdToken("not-a-jwt")).toBeNull();
  });

  it("names the account by email, else by sub", () => {
    expect(
      identityFromIdToken(jwt({ sub: "s", email: "a@example.com" })),
    ).toEqual({
      sub: "s",
      username: "a@example.com",
    });
    expect(identityFromIdToken(jwt({ sub: "s" }))).toEqual({
      sub: "s",
      username: "s",
    });
  });
});
