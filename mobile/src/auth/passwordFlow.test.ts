// Every branch of a password attempt (ADR 0045). Each names its mutation.
import { beforeEach, describe, expect, it, vi } from "vitest";

const signInWithPassword = vi.fn();
const finishSignIn = vi.fn();
const isReachableNow = vi.fn();
const updateConsent = vi.fn();
const fetchCurrentUser = vi.fn();

vi.mock("./oidcSession", () => ({
  signInWithPassword: (...a: unknown[]) => signInWithPassword(...a),
}));
vi.mock("./finishSignIn", () => ({
  finishSignIn: (...a: unknown[]) => finishSignIn(...a),
}));
vi.mock("../map/connectivity", () => ({
  isReachableNow: () => isReachableNow(),
}));
vi.mock("../api/queries", () => ({
  updateConsent: (...a: unknown[]) => updateConsent(...a),
  fetchCurrentUser: () => fetchCurrentUser(),
}));

const { OFFLINE_SIGN_IN, signInWithPasswordFlow, usesOwnForms } = await import(
  "./passwordFlow"
);

const named = (name: string) => Object.assign(new Error("x"), { name });
const session = { type: "success", idToken: "i", commit: vi.fn() };

beforeEach(() => {
  for (const m of [
    signInWithPassword,
    finishSignIn,
    isReachableNow,
    updateConsent,
  ])
    m.mockReset();
  isReachableNow.mockResolvedValue(true);
  finishSignIn.mockResolvedValue({ ok: true });
  updateConsent.mockResolvedValue({});
  fetchCurrentUser.mockResolvedValue({ currentConsentVersion: "2999-01-01" });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("usesOwnForms", () => {
  const COGNITO =
    "https://cognito-idp.ap-southeast-2.amazonaws.com/ap-southeast-2_AbC123";
  // Mutation: drop the fake-auth check, or the issuer check.
  it("is a Cognito issuer under real auth, and nothing else", () => {
    expect(usesOwnForms("oidc", COGNITO)).toBe(true);
    expect(usesOwnForms("fake", COGNITO)).toBe(false);
    expect(usesOwnForms("oidc", "https://keycloak.test/realms/logjam")).toBe(
      false,
    );
    expect(usesOwnForms("oidc", undefined)).toBe(false);
  });
});

describe("signInWithPasswordFlow", () => {
  // Mutation: skip finishSignIn, or commit the session before it.
  it("finishes through finishSignIn, as the browser does", async () => {
    signInWithPassword.mockResolvedValue(session);
    expect(await signInWithPasswordFlow("a@b.co", "pw")).toEqual({
      type: "signedIn",
    });
    expect(finishSignIn).toHaveBeenCalledWith(session);
    expect(updateConsent).not.toHaveBeenCalled();
  });

  // Mutation: return `signedIn` when finishSignIn says no.
  it("stays on the form when finishing is refused (a wipe that failed)", async () => {
    signInWithPassword.mockResolvedValue(session);
    finishSignIn.mockResolvedValue({ ok: false, error: "Couldn't clear it." });
    expect(await signInWithPasswordFlow("a@b.co", "pw")).toEqual({
      type: "form",
      message: "Couldn't clear it.",
      unconfirmed: false,
    });
  });

  // Mutation: record consent before finishSignIn, without the username, or with
  // this build's CURRENT_CONSENT_VERSION.
  it("records a new account's consent and username after it signs in", async () => {
    signInWithPassword.mockResolvedValue(session);
    await signInWithPasswordFlow("a@b.co", "pw", "canyon_fan");
    expect(updateConsent).toHaveBeenCalledWith("2999-01-01", "canyon_fan");
    expect(finishSignIn.mock.invocationCallOrder[0]).toBeLessThan(
      updateConsent.mock.invocationCallOrder[0],
    );
  });

  // Mutation: let a consent failure fail the sign-in. ConsentGate asks instead.
  it("signs in anyway when recording consent fails", async () => {
    signInWithPassword.mockResolvedValue(session);
    updateConsent.mockRejectedValue(new Error("offline"));
    expect(await signInWithPasswordFlow("a@b.co", "pw", "canyon_fan")).toEqual({
      type: "signedIn",
    });
  });

  // Mutation: drop the `isLinkFailure` branch, and these open the browser sheet.
  it.each([
    ["SessionTimeoutError"],
    ["TypeError"],
    ["InternalErrorException"],
    ["ServiceUnavailableException"],
  ])("stays on the form after a %s while online", async (name) => {
    const err = new Error("nope");
    err.name = name;
    signInWithPassword.mockRejectedValue(err);
    expect(await signInWithPasswordFlow("a@b.co", "pw")).toEqual({
      type: "form",
      message: "Couldn't reach sign-in. Try again.",
      unconfirmed: false,
    });
  });

  // Mutation: treat a null as an error.
  it("hands over to the provider for a challenge the form cannot answer", async () => {
    signInWithPassword.mockResolvedValue({ type: "provider" });
    expect(await signInWithPasswordFlow("a@b.co", "pw")).toEqual({
      type: "provider",
    });
    expect(finishSignIn).not.toHaveBeenCalled();
  });

  it.each([
    "NotAuthorizedException",
    "UserNotFoundException",
    "LimitExceededException",
    "TooManyRequestsException",
  ])("keeps Cognito's %s on the form", async (name) => {
    signInWithPassword.mockRejectedValue(named(name));
    const result = await signInWithPasswordFlow("a@b.co", "pw");
    expect(result).toMatchObject({ type: "form", unconfirmed: false });
    expect((result as { message: string }).message.length).toBeGreaterThan(0);
  });

  // Mutation: drop `unconfirmed`.
  it("asks for the emailed code when the account was never confirmed", async () => {
    signInWithPassword.mockRejectedValue(named("UserNotConfirmedException"));
    expect(await signInWithPasswordFlow("a@b.co", "pw")).toMatchObject({
      type: "form",
      unconfirmed: true,
    });
  });

  // Mutation: add InvalidParameterException (or all errors) to the form answers.
  it("hands over to the provider for a failure that is not Cognito's answer", async () => {
    for (const err of [
      named("InvalidParameterException"),
      new Error("Discovery answered 503"),
    ]) {
      signInWithPassword.mockRejectedValue(err);
      expect(await signInWithPasswordFlow("a@b.co", "pw")).toEqual({
        type: "provider",
      });
    }
  });

  // Mutation: skip the reachability check: an offline phone is thrown into a
  // browser that cannot load.
  it("shows a message instead of a browser that cannot load when offline", async () => {
    isReachableNow.mockResolvedValue(false);
    signInWithPassword.mockRejectedValue(new Error("timed out"));
    expect(await signInWithPasswordFlow("a@b.co", "pw")).toEqual({
      type: "form",
      message: OFFLINE_SIGN_IN,
      unconfirmed: false,
    });
  });

  it("treats an unreadable connection state as online", async () => {
    isReachableNow.mockRejectedValue(new Error("netinfo"));
    signInWithPassword.mockRejectedValue(new Error("boom"));
    expect(await signInWithPasswordFlow("a@b.co", "pw")).toEqual({
      type: "provider",
    });
  });
});
