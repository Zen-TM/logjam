import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorResponse } from "oidc-client-ts";

const m = vi.hoisted(() => ({
  getUser: vi.fn(),
  storeUser: vi.fn(async () => {}),
  removeUser: vi.fn(async () => {}),
  revokeTokens: vi.fn(async () => {}),
  signinSilent: vi.fn(),
  signinCallback: vi.fn(),
  signinRedirect: vi.fn(async () => {}),
  getMetadata: vi.fn(),
}));

vi.mock("oidc-client-ts", async (orig) => ({
  ...(await orig<typeof import("oidc-client-ts")>()),
  UserManager: class {
    getUser = m.getUser;
    storeUser = m.storeUser;
    removeUser = m.removeUser;
    revokeTokens = m.revokeTokens;
    signinSilent = m.signinSilent;
    signinCallback = m.signinCallback;
    signinRedirect = m.signinRedirect;
    metadataService = { getMetadata: m.getMetadata };
  },
}));

const COGNITO =
  "https://cognito-idp.ap-southeast-2.amazonaws.com/ap-southeast-2_x5zPhJXMk";

function setUrl(path: string) {
  window.history.replaceState({}, "", path);
}

// Each test gets a fresh module: the manager, the shared refresh and the
// once-only callback are module state.
async function load() {
  vi.resetModules();
  return import("./oidc");
}

const stored = (over: object = {}) => ({
  id_token: "id1",
  access_token: "at1",
  refresh_token: "rt1",
  expires_in: 3000,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("VITE_AUTH_MODE", "oidc");
  vi.stubEnv("VITE_OIDC_ISSUER", COGNITO);
  vi.stubEnv("VITE_OIDC_CLIENT_ID", "cid");
  setUrl("/");
  vi.spyOn(window.history, "replaceState");
});

describe("loadSession", () => {
  it("returns an unexpired stored session without touching the network", async () => {
    const { loadSession } = await load();
    m.getUser.mockResolvedValue(stored());
    expect((await loadSession())?.id_token).toBe("id1");
    expect(m.signinSilent).not.toHaveBeenCalled();
  });

  // Mutation: drop the in-flight sharing in loadSession and this sees 3 calls.
  it("shares one refresh between concurrent callers", async () => {
    const { loadSession } = await load();
    m.getUser.mockResolvedValue(stored({ expires_in: 0 }));
    m.signinSilent.mockResolvedValue(stored({ id_token: "id2" }));
    const all = await Promise.all([
      loadSession(),
      loadSession(),
      loadSession(),
    ]);
    expect(all.map((u) => u?.id_token)).toEqual(["id2", "id2", "id2"]);
    expect(m.signinSilent).toHaveBeenCalledOnce();
  });

  // Mutation: skip the `force` argument and sign-out everywhere signs out
  // with an access token that may already be dead.
  it("refreshes a valid session when forced", async () => {
    const { loadSession } = await load();
    m.getUser.mockResolvedValue(stored());
    m.signinSilent.mockResolvedValue(stored({ access_token: "at2" }));
    expect((await loadSession(true))?.access_token).toBe("at2");
  });

  it("is null with no session, and null with a refresh token missing", async () => {
    const { loadSession } = await load();
    m.getUser.mockResolvedValue(null);
    expect(await loadSession()).toBeNull();
    m.getUser.mockResolvedValue(
      stored({ expires_in: 0, refresh_token: undefined }),
    );
    expect(await loadSession()).toBeNull();
    expect(m.signinSilent).not.toHaveBeenCalled();
  });

  // Mutation: treat every refresh failure as rejection (drop the instanceof)
  // and an offline refresh deletes a session the provider still honours.
  // Mutation: drop the `err.error === "invalid_grant"` test and a 503 wipes a
  // refresh token that was fine.
  it("keeps the session through a provider outage (server_error, 503)", async () => {
    const { loadSession } = await load();
    m.getUser.mockResolvedValue(stored({ expires_in: 0 }));
    for (const error of ["server_error", "temporarily_unavailable"]) {
      m.signinSilent.mockRejectedValueOnce(new ErrorResponse({ error }));
      await expect(loadSession()).rejects.toThrow();
    }
    expect(m.removeUser).not.toHaveBeenCalled();
  });

  it("removes the session when the provider rejects the refresh, and only then", async () => {
    const { loadSession } = await load();
    m.getUser.mockResolvedValue(stored({ expires_in: 0 }));
    m.signinSilent.mockRejectedValueOnce(
      new ErrorResponse({ error: "invalid_grant" }),
    );
    expect(await loadSession()).toBeNull();
    expect(m.removeUser).toHaveBeenCalledOnce();

    m.removeUser.mockClear();
    m.signinSilent.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(loadSession()).rejects.toThrow("Failed to fetch");
    expect(m.removeUser).not.toHaveBeenCalled();
  });
});

describe("completeSignInFromUrl", () => {
  it("is null, and does nothing, when the address carries no answer", async () => {
    const { completeSignInFromUrl } = await load();
    setUrl("/?foo=1");
    expect(await completeSignInFromUrl()).toBeNull();
    expect(m.signinCallback).not.toHaveBeenCalled();
  });

  // Mutation: drop the replaceState and the one-time code stays in the
  // address bar, history and bookmarks.
  it("finishes the sign-in and strips the code and state, keeping the rest", async () => {
    const { completeSignInFromUrl } = await load();
    setUrl("/?x=1&code=abc&state=s1#h");
    m.signinCallback.mockResolvedValue(stored());
    expect((await completeSignInFromUrl())?.id_token).toBe("id1");
    expect(m.signinCallback.mock.calls[0][0]).toContain("code=abc");
    expect(window.location.search).toBe("?x=1");
    expect(window.location.hash).toBe("#h");
  });

  it("strips an error answer too, and throws it", async () => {
    const { completeSignInFromUrl } = await load();
    setUrl("/?error=access_denied&error_description=nope");
    m.signinCallback.mockRejectedValue(new Error("access_denied"));
    await expect(completeSignInFromUrl()).rejects.toThrow("access_denied");
    expect(window.location.search).toBe("");
  });

  it("runs once however often it is asked", async () => {
    const { completeSignInFromUrl } = await load();
    setUrl("/?code=abc&state=s1");
    m.signinCallback.mockResolvedValue(stored());
    await Promise.all([completeSignInFromUrl(), completeSignInFromUrl()]);
    expect(m.signinCallback).toHaveBeenCalledOnce();
  });
});

describe("signInRedirect", () => {
  it("asks for the Cognito scope on a Cognito issuer and offline_access only if listed", async () => {
    const { signInRedirect } = await load();
    m.getMetadata.mockResolvedValue({ scopes_supported: ["openid"] });
    await signInRedirect();
    expect(m.signinRedirect).toHaveBeenCalledWith({
      scope: "openid email profile aws.cognito.signin.user.admin",
    });
  });
});

describe("endProviderSession", () => {
  const origin = window.location.origin;

  // Mutation: drop removeUser, or return home instead of the end-session URL,
  // and the provider's session (or this browser's) outlives the sign-out.
  it("forgets the session here, then ends the provider's", async () => {
    const { endProviderSession } = await load();
    m.getUser.mockResolvedValue(stored());
    m.getMetadata.mockResolvedValue({
      end_session_endpoint: "https://auth.example.com/logout",
    });
    const to = new URL(await endProviderSession());
    expect(m.removeUser).toHaveBeenCalledOnce();
    expect(to.origin + to.pathname).toBe("https://auth.example.com/logout");
    expect(to.searchParams.get("client_id")).toBe("cid");
    expect(to.searchParams.get("logout_uri")).toBe(`${origin}/`);
  });

  // Mutation: drop the revokeTokens call and the refresh token outlives the
  // sign-out; let its failure propagate and the second test goes red.
  it("revokes the refresh token before it leaves", async () => {
    const { endProviderSession } = await load();
    m.getUser.mockResolvedValue(stored());
    m.getMetadata.mockResolvedValue({
      end_session_endpoint: "https://auth.example.com/logout",
    });
    await endProviderSession();
    expect(m.revokeTokens).toHaveBeenCalledWith(["refresh_token"]);
    expect(m.revokeTokens.mock.invocationCallOrder[0]).toBeLessThan(
      m.removeUser.mock.invocationCallOrder[0],
    );
  });

  it("still signs out when the revoke fails", async () => {
    const { endProviderSession } = await load();
    vi.spyOn(console, "error").mockImplementation(() => {});
    m.getUser.mockResolvedValue(stored());
    m.getMetadata.mockResolvedValue({
      end_session_endpoint: "https://auth.example.com/logout",
    });
    m.revokeTokens.mockRejectedValue(new TypeError("Failed to fetch"));
    await endProviderSession();
    expect(m.removeUser).toHaveBeenCalledOnce();
  });

  it("still leaves when the provider cannot be asked", async () => {
    const { endProviderSession } = await load();
    vi.spyOn(console, "error").mockImplementation(() => {});
    m.getUser.mockResolvedValue(stored());
    m.getMetadata.mockRejectedValue(new Error("offline"));
    expect(await endProviderSession()).toBe(`${origin}/`);
    expect(m.removeUser).toHaveBeenCalledOnce();
  });
});

describe("signInWithPassword", () => {
  const jwt = (claims: object) =>
    `h.${btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(claims)))).replace(/=+$/, "")}.s`;
  const answer = (body: object) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => body })),
    );

  // Mutation: store the password, or leave profile empty, and the refresh that
  // compares the subject fails on the next expired token.
  it("stores the session the redirect would, and no password", async () => {
    answer({
      AuthenticationResult: {
        IdToken: jwt({ sub: "s1", name: "Zoë" }),
        AccessToken: "at",
        RefreshToken: "rt",
        ExpiresIn: 3600,
      },
    });
    const { signInWithPassword } = await load();
    expect(await signInWithPassword("a@b.co", "s3cret!")).toBe(true);
    const user = (m.storeUser.mock.calls as unknown[][])[0][0] as {
      profile: { sub: string; name: string };
      refresh_token: string;
      expires_in: number;
    };
    expect(user.profile).toMatchObject({ sub: "s1", name: "Zoë" });
    expect(user.refresh_token).toBe("rt");
    expect(user.expires_in).toBeGreaterThan(3500);
    expect(JSON.stringify(user)).not.toContain("s3cret!");
  });

  it("stores nothing when Cognito wants more", async () => {
    answer({ ChallengeName: "SOFTWARE_TOKEN_MFA" });
    const { signInWithPassword } = await load();
    expect(await signInWithPassword("a@b.co", "pw")).toBe(false);
    expect(m.storeUser).not.toHaveBeenCalled();
  });
});
