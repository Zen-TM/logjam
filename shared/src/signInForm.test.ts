import { afterEach, describe, expect, it, vi } from "vitest";
import {
  failureStaysOnForm,
  isValidEmailFormat,
  isValidPassword,
  signUpFormProblem,
  usernameAvailable,
} from "./signInForm.js";
import { passwordSignIn } from "./cognitoAccount.js";

// Both clients' forms call these, so one test holds them (ADR 0020).
// Mutations that turn it red: add "InvalidParameterException" to FORM_ANSWERS
// (the fallback test), swap the order of the password and terms checks (the
// order test), or make `usernameAvailable` return false when the request
// fails (the unknown-counts-as-free test).

const good = {
  name: "Canyon Fan",
  email: "a@b.co",
  username: "canyon_fan",
  password: "Abcdef1!",
  confirmPassword: "Abcdef1!",
  agreed: true,
  ageConfirmed: true,
};
const named = (name: string) => Object.assign(new Error("x"), { name });

afterEach(() => vi.unstubAllGlobals());

describe("signUpFormProblem", () => {
  it("accepts a complete form", () => {
    expect(signUpFormProblem(good)).toBeNull();
  });

  // Mutation: drop the name check.
  it("asks for a name, which Cognito would otherwise refuse", () => {
    expect(signUpFormProblem({ ...good, name: "  " })?.message).toBe(
      "Enter your name.",
    );
  });

  it("names the first problem, in the order the form reads", () => {
    const all = {
      ...good,
      email: "nope",
      username: "x",
      confirmPassword: "different",
      agreed: false,
      ageConfirmed: false,
    };
    expect(signUpFormProblem(all)?.field).toBe("email");
    expect(signUpFormProblem({ ...all, email: good.email })?.field).toBe(
      "username",
    );
    const noUsername = { ...all, email: good.email, username: good.username };
    expect(signUpFormProblem(noUsername)?.message).toBe(
      "Passwords do not match",
    );
    expect(
      signUpFormProblem({ ...noUsername, confirmPassword: good.password }),
    ).toMatchObject({
      field: "form",
      message: expect.stringMatching(/agree/i),
    });
    expect(
      signUpFormProblem({ ...good, ageConfirmed: false })?.message,
    ).toMatch(/18/);
    expect(
      signUpFormProblem({
        ...good,
        password: "short",
        confirmPassword: "short",
      })?.message,
    ).toMatch(/at least 8/);
  });
});

describe("formats", () => {
  it("checks a password for each class", () => {
    expect(isValidPassword("Abcdef1!")).toBe(true);
    for (const bad of ["abcdef1!", "ABCDEF1!", "Abcdefg!", "Abcdefg1", "Ab1!"])
      expect(isValidPassword(bad)).toBe(false);
  });
  it("checks an email's shape", () => {
    expect(isValidEmailFormat(" a@b.co ")).toBe(true);
    expect(isValidEmailFormat("a@b")).toBe(false);
  });
});

describe("failureStaysOnForm", () => {
  it("keeps Cognito's answers about this attempt on the form", () => {
    for (const name of [
      "NotAuthorizedException",
      "UserNotConfirmedException",
      "UserNotFoundException",
      "LimitExceededException",
      "TooManyRequestsException",
    ])
      expect(failureStaysOnForm(named(name), true)).toBe(true);
  });
  it("hands anything else to the provider's page while online", () => {
    expect(failureStaysOnForm(named("InvalidParameterException"), true)).toBe(
      false,
    );
    expect(
      failureStaysOnForm(new TypeError("Network request failed"), true),
    ).toBe(false);
    expect(failureStaysOnForm("a string", true)).toBe(false);
  });
  it("keeps every failure on the form offline", () => {
    expect(failureStaysOnForm(named("InvalidParameterException"), false)).toBe(
      true,
    );
  });
});

describe("usernameAvailable", () => {
  const ask = (reply: () => Promise<unknown>) => {
    const f = vi.fn(reply);
    vi.stubGlobal("fetch", f);
    return f;
  };
  it("asks with no token and reads the answer", async () => {
    const f = ask(async () => ({
      ok: true,
      json: async () => ({ available: false }),
    }));
    expect(await usernameAvailable("http://api", "a b", { h: "1" })).toBe(
      false,
    );
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://api/users/username-available?username=a%20b");
    expect(init.headers).toEqual({ h: "1" });
  });
  it("counts unknown as free", async () => {
    ask(async () => ({ ok: false }));
    expect(await usernameAvailable("http://api", "abc")).toBe(true);
    ask(async () => {
      throw new TypeError("Network request failed");
    });
    expect(await usernameAvailable("http://api", "abc")).toBe(true);
  });
});

describe("a call can be bounded", () => {
  it("hands the signal to fetch", async () => {
    const f = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    vi.stubGlobal("fetch", f);
    const signal = new AbortController().signal;
    await passwordSignIn(
      "https://cognito-idp.ap-southeast-2.amazonaws.com/ap-southeast-2_x5zPhJXMk",
      "cid",
      "a@b.co",
      "pw",
      signal,
    );
    expect(
      (f.mock.calls[0] as unknown as [string, RequestInit])[1].signal,
    ).toBe(signal);
  });
});
