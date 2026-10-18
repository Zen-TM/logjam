// Guard: under fake auth Amplify is never configured (amplifyConfig.ts), so the
// sign-in and sign-up forms must not call it: they sign straight in as the
// build's fake user, the way a fake-auth launch does. Drop the fake-mode branch
// from `handleSignIn` or `handleSignUp` in useAuth.ts and the matching test goes
// red; make the same branch fire under Cognito and the last two go red.
//
// React is stubbed so the hook runs as a plain function: mobile's vitest has no
// jsdom or renderer.
import { beforeEach, describe, expect, it, vi } from "vitest";

const setState = vi.fn();
const amplify = {
  signIn: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
  confirmSignUp: vi.fn(),
  resendSignUpCode: vi.fn(),
  resetPassword: vi.fn(),
  confirmResetPassword: vi.fn(),
};
const writeEntryChoice = vi.fn();
const config = { authMode: "fake" };

vi.mock("react", () => ({
  useState: (init: unknown) => [
    typeof init === "function" ? (init as () => unknown)() : init,
    setState,
  ],
  useCallback: (fn: unknown) => fn,
  useEffect: () => {},
}));
vi.mock("react-native", () => ({ AppState: { addEventListener: vi.fn() } }));
vi.mock("aws-amplify/auth", () => ({
  confirmResetPassword: amplify.confirmResetPassword,
  confirmSignUp: amplify.confirmSignUp,
  resendSignUpCode: amplify.resendSignUpCode,
  resetPassword: amplify.resetPassword,
  signIn: amplify.signIn,
  signOut: amplify.signOut,
  signUp: amplify.signUp,
}));
vi.mock("../config", () => ({ config }));
vi.mock("../api/apiFetch", () => ({
  apiFetch: vi.fn().mockResolvedValue(undefined),
  setSessionRejectedHandler: vi.fn(),
}));
vi.mock("./authSession", () => ({
  fetchAuthSessionWithTimeout: vi.fn().mockResolvedValue({ tokens: {} }),
}));
vi.mock("./cognitoSignOut", () => ({ cognitoSignOut: vi.fn() }));
vi.mock("../offline/wipeLocalData", () => ({ wipeAllLocalData: vi.fn() }));
vi.mock("../notifications/pushRegistration", () => ({
  unregisterPushNotifications: vi.fn(),
}));
vi.mock("./guestModePreference", () => ({
  clearEntryChoice: vi.fn(),
  readEntryChoice: () => "unchosen",
  writeEntryChoice,
}));
vi.mock("./localIdentity", () => ({
  clearLocalIdentity: vi.fn(),
  readLocalIdentity: vi.fn().mockResolvedValue(null),
  readPreviousIdentity: vi.fn().mockResolvedValue(null),
  signInNeedsWipe: vi.fn().mockReturnValue(false),
  writeLocalIdentity: vi.fn(),
}));

const { useAuth } = await import("./useAuth");

beforeEach(() => {
  setState.mockReset();
  writeEntryChoice.mockReset().mockReturnValue(true);
  for (const fn of Object.values(amplify)) fn.mockReset();
  config.authMode = "fake";
});

describe("fake-auth sign-in", () => {
  it("signs straight in, whatever was typed, without calling Amplify", async () => {
    const ok = await useAuth().signIn("nobody", "wrong");
    expect(ok).toBe(true);
    expect(setState).toHaveBeenLastCalledWith("authenticated");
    expect(amplify.signIn).not.toHaveBeenCalled();
  });

  it("records the account choice, so a guest who links does not restart as a guest", async () => {
    await useAuth().signIn("alice", "pw");
    expect(writeEntryChoice).toHaveBeenCalledWith("account");
  });

  it("signs straight in from the sign-up form too", async () => {
    await useAuth().signUp("new", "pw", "new@example.com", "New");
    expect(setState).toHaveBeenLastCalledWith("authenticated");
    expect(writeEntryChoice).toHaveBeenCalledWith("account");
    expect(amplify.signUp).not.toHaveBeenCalled();
  });
});

describe("Cognito sign-in", () => {
  beforeEach(() => {
    config.authMode = "cognito";
    amplify.signIn.mockResolvedValue({
      isSignedIn: false,
      nextStep: { signInStep: "DONE" },
    });
    amplify.signUp.mockResolvedValue({
      isSignUpComplete: false,
      nextStep: { signUpStep: "CONFIRM_SIGN_UP" },
    });
  });

  it("still calls Amplify to sign in", async () => {
    await useAuth().signIn("alice@example.com", "pw");
    expect(amplify.signIn).toHaveBeenCalledWith({
      username: "alice@example.com",
      password: "pw",
    });
    expect(setState).not.toHaveBeenCalledWith("authenticated");
  });

  it("still calls Amplify to sign up", async () => {
    await useAuth().signUp("new", "pw", "new@example.com", "New");
    expect(amplify.signUp).toHaveBeenCalledOnce();
    expect(setState).toHaveBeenLastCalledWith("confirmSignUp");
  });
});
