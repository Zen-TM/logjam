// The guarantee: this call always settles.
//
// Every screen behind `App`'s loading state, and every `apiFetch`, waits on it.
// The field failure it exists for is a connect that neither succeeds nor fails,
// which no `catch` can rescue — so the test that matters is the one where
// Amplify never resolves at all.
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchAuthSessionMock = vi.fn();
vi.mock("aws-amplify/auth", () => ({
  fetchAuthSession: () => fetchAuthSessionMock(),
}));

const { fetchAuthSessionWithTimeout, AuthSessionTimeoutError, SESSION_TIMEOUT_MS } =
  await import("./authSession");
const { classifySessionError } = await import("./sessionErrors");

beforeEach(() => {
  fetchAuthSessionMock.mockReset();
  vi.useRealTimers();
});

describe("fetchAuthSessionWithTimeout", () => {
  it("passes the session through when Amplify answers", async () => {
    const session = { tokens: { idToken: "token" } };
    fetchAuthSessionMock.mockResolvedValue(session);
    await expect(fetchAuthSessionWithTimeout()).resolves.toBe(session);
  });

  it("rejects rather than hanging when Amplify never settles", async () => {
    vi.useFakeTimers();
    fetchAuthSessionMock.mockReturnValue(new Promise(() => {}));

    const pending = fetchAuthSessionWithTimeout();
    const settled = vi.fn();
    void pending.catch(settled);

    await vi.advanceTimersByTimeAsync(SESSION_TIMEOUT_MS - 1);
    expect(settled).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2);
    await expect(pending).rejects.toBeInstanceOf(AuthSessionTimeoutError);
  });

  // Load-bearing: a timeout must NOT read as "Cognito rejected this session",
  // which is what forces re-auth. Offline-first rule — a timed-out refresh in a
  // canyon keeps the session and keeps local data usable.
  it("classifies a timeout as transient, never rejected", () => {
    expect(classifySessionError(new AuthSessionTimeoutError())).toBe("transient");
  });

  it("surfaces a real Amplify failure unchanged", async () => {
    const err = Object.assign(new Error("nope"), { name: "NotAuthorizedException" });
    fetchAuthSessionMock.mockRejectedValue(err);
    await expect(fetchAuthSessionWithTimeout()).rejects.toBe(err);
    expect(classifySessionError(err)).toBe("rejected");
  });
});
