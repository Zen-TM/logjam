// Guard: signing out under fake auth never calls Amplify, which is not
// configured there (amplifyConfig.ts) and raises NoAmplifyContextError. Drop
// the fake-mode early return in cognitoSignOut.ts and the second test goes red;
// drop the `signOut()` call and the first does.
import { beforeEach, describe, expect, it, vi } from "vitest";

const signOutMock = vi.fn();
const fetchAuthSessionMock = vi.fn();
const config = { authMode: "cognito" };

vi.mock("aws-amplify/auth", () => ({
  signOut: (input?: unknown) => signOutMock(input),
  fetchAuthSession: (input?: unknown) => fetchAuthSessionMock(input),
}));
vi.mock("../config", () => ({ config }));

const { assertCanSignOutEverywhere, cognitoSignOut } = await import(
  "./cognitoSignOut"
);

beforeEach(() => {
  signOutMock.mockReset().mockResolvedValue(undefined);
  fetchAuthSessionMock.mockReset().mockResolvedValue({ tokens: {} });
  config.authMode = "cognito";
});

describe("cognitoSignOut", () => {
  it("signs out of Cognito on this phone only by default", async () => {
    await cognitoSignOut();
    expect(signOutMock).toHaveBeenCalledOnce();
    expect(signOutMock).toHaveBeenCalledWith({ global: false });
  });

  it("revokes every session when asked to sign out everywhere", async () => {
    await cognitoSignOut({ everywhere: true });
    expect(signOutMock).toHaveBeenCalledWith({ global: true });
  });

  it("does not touch Amplify under fake auth, which never configures it", async () => {
    config.authMode = "fake";
    await cognitoSignOut();
    expect(signOutMock).not.toHaveBeenCalled();
  });

  it("reports a failed Cognito sign-out to the caller", async () => {
    signOutMock.mockRejectedValue(new Error("offline"));
    await expect(cognitoSignOut()).rejects.toThrow("offline");
  });
});

// Guard: Amplify's global sign-out swallows a failed GlobalSignOut and still
// clears the phone. Drop the forced refresh in assertCanSignOutEverywhere and
// the first two tests go red; drop the `!tokens` check and the second does.
describe("assertCanSignOutEverywhere", () => {
  it("forces a refresh so a stale access token cannot fail silently", async () => {
    await assertCanSignOutEverywhere();
    expect(fetchAuthSessionMock).toHaveBeenCalledWith({ forceRefresh: true });
  });

  it("throws when the refresh is rejected and leaves no tokens", async () => {
    fetchAuthSessionMock.mockResolvedValue({ tokens: undefined });
    await expect(assertCanSignOutEverywhere()).rejects.toThrow();
  });

  it("throws when the phone cannot reach Logjam", async () => {
    fetchAuthSessionMock.mockRejectedValue(new Error("offline"));
    await expect(assertCanSignOutEverywhere()).rejects.toThrow("offline");
  });

  it("does not touch Amplify under fake auth", async () => {
    config.authMode = "fake";
    await assertCanSignOutEverywhere();
    expect(fetchAuthSessionMock).not.toHaveBeenCalled();
  });
});
