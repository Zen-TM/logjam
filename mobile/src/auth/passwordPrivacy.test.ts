// A password reaches neither secure storage nor anything Sentry would send
// (ADR 0045, root AGENTS.md Privacy). Sentry's events are built from what the
// code throws and from `console.*` calls (its breadcrumbs, ADR 0004), so this
// runs the real sign-in, sign-up and reset paths through every outcome with a
// recognisable password and looks for it in all three places: the secure
// store, every console argument, and every error or message handed back.
//
// Mutation that turns it red: in passwordFlow.ts change the hand-over log to
// `console.error("handed over", { email, password })`, or in oidcSession.ts add
// `password` to the `Stored` record `signInWithPassword` writes.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PASSWORD = "Zq9!hunter2-CANARY";

const config = {
  authMode: "oidc",
  oidcIssuer:
    "https://cognito-idp.ap-southeast-2.amazonaws.com/ap-southeast-2_AbC123",
  oidcClientId: "client",
};
const secure = new Map<string, string>();
const writes: string[] = [];
const fetchMock = vi.fn();

vi.stubGlobal("fetch", fetchMock);
vi.mock("../config", () => ({ config }));
vi.mock("expo-secure-store", () => ({
  getItemAsync: async (k: string) => secure.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => {
    writes.push(`${k}=${v}`);
    secure.set(k, v);
  },
  deleteItemAsync: async (k: string) => {
    secure.delete(k);
  },
}));
vi.mock("expo-constants", () => ({
  default: { expoConfig: { scheme: "logjam" } },
}));
vi.mock("expo-auth-session", () => ({
  ResponseType: {},
  AuthRequest: class {},
}));
vi.mock("expo-web-browser", () => ({}));
vi.mock("../map/connectivity", () => ({
  isReachableNow: vi.fn(async () => true),
}));
vi.mock("../api/queries", () => ({ updateConsent: vi.fn(async () => ({})) }));
// What the real finishSignIn does with the session, without its wipe and API.
vi.mock("./finishSignIn", () => ({
  finishSignIn: async (s: { commit: () => Promise<void> }) => {
    await s.commit();
    return { ok: true };
  },
}));

const { accountCalls } = await import("./oidcSession");
const { signInWithPasswordFlow } = await import("./passwordFlow");

const idToken = `${Buffer.from("{}").toString("base64url")}.${Buffer.from(
  JSON.stringify({ sub: "s1", exp: 4_000_000_000 }),
).toString("base64url")}.sig`;
const reply = (status: number, body: unknown) => ({
  ok: status < 300,
  status,
  json: async () => body,
});
const discovery = reply(200, {
  authorization_endpoint: "https://auth.test/authorize",
  token_endpoint: "https://auth.test/token",
});
const signedIn = reply(200, {
  AuthenticationResult: {
    IdToken: idToken,
    AccessToken: "a",
    RefreshToken: "r",
    ExpiresIn: 3600,
  },
});

const consoleOut: unknown[][] = [];
const seen = (value: unknown) =>
  JSON.stringify(value, (_k, v) =>
    v instanceof Error
      ? { name: v.name, message: v.message, stack: v.stack }
      : v,
  ) ?? "";

beforeEach(() => {
  secure.clear();
  writes.length = 0;
  consoleOut.length = 0;
  fetchMock.mockReset();
  for (const level of ["log", "info", "warn", "error", "debug"] as const)
    vi.spyOn(console, level).mockImplementation((...a: unknown[]) => {
      consoleOut.push(a);
    });
});
afterEach(() => vi.restoreAllMocks());

const outcomes: [string, (url: string) => unknown][] = [
  ["a sign-in", (u) => (u.endsWith("configuration") ? discovery : signedIn)],
  [
    "a wrong password",
    (u) =>
      u.endsWith("configuration")
        ? discovery
        : reply(400, {
            __type: "NotAuthorizedException",
            message: "Incorrect",
          }),
  ],
  [
    "a challenge",
    (u) =>
      u.endsWith("configuration")
        ? discovery
        : reply(200, { ChallengeName: "SOFTWARE_TOKEN_MFA" }),
  ],
  [
    "a blocked request",
    (u) =>
      u.endsWith("configuration")
        ? discovery
        : reply(400, { __type: "InvalidParameterException", message: "No" }),
  ],
  ["a discovery outage", () => reply(503, {})],
  [
    "no network",
    () => {
      throw new TypeError("Network request failed");
    },
  ],
];

describe("a password", () => {
  it.each(outcomes)(
    "stays out of storage, logs and errors on %s",
    async (_n, answer) => {
      fetchMock.mockImplementation(async (url: string) => answer(url));
      const result = await signInWithPasswordFlow(
        "a@example.com",
        PASSWORD,
        "canyon_fan",
      );
      expect(seen(result)).not.toContain(PASSWORD);
      expect(writes.join("\n")).not.toContain(PASSWORD);
      expect(seen(consoleOut)).not.toContain(PASSWORD);
    },
  );

  it("stays out of storage, logs and errors on the sign-up and reset calls", async () => {
    const errors: unknown[] = [];
    for (const answer of [
      reply(200, {}),
      reply(400, { __type: "UsernameExistsException" }),
    ]) {
      fetchMock.mockResolvedValue(answer);
      for (const run of [
        () =>
          accountCalls.signUp({
            email: "a@b.co",
            password: PASSWORD,
            name: "n",
          }),
        () => accountCalls.confirmForgotPassword("a@b.co", "123456", PASSWORD),
      ])
        await run().catch((e: unknown) => errors.push(e));
    }
    fetchMock.mockRejectedValue(new TypeError("Network request failed"));
    await accountCalls
      .signUp({ email: "a@b.co", password: PASSWORD, name: "n" })
      .catch((e: unknown) => errors.push(e));
    expect(errors.length).toBeGreaterThan(0);
    expect(seen(errors)).not.toContain(PASSWORD);
    expect(writes.join("\n")).not.toContain(PASSWORD);
    expect(seen(consoleOut)).not.toContain(PASSWORD);
  });

  it("is sent to Cognito and to nowhere else", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith("configuration") ? discovery : signedIn,
    );
    await signInWithPasswordFlow("a@example.com", PASSWORD);
    const carriers = fetchMock.mock.calls
      .filter(([, init]) => String(init?.body ?? "").includes(PASSWORD))
      .map(([url]) => url);
    expect(carriers).toEqual([
      "https://cognito-idp.ap-southeast-2.amazonaws.com/",
    ]);
  });
});
