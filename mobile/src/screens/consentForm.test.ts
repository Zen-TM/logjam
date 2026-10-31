// Guard: a new account cannot finish without a valid username, the terms and
// its age. Drop the `newAccount` username check, the age check, or the `agreed`
// check in consentFormProblem and the matching test goes red; apply the new-
// account questions to a returning user and the last test goes red.
import { describe, expect, it } from "vitest";

import { ApiError } from "@logjam/shared";

import { consentFormProblem, consentSubmitFailure } from "./consentForm";

const ok = { username: "alice.k", agreed: true, ageConfirmed: true };

describe("consentFormProblem, a new account", () => {
  const form = { ...ok, newAccount: true };

  it("lets a complete form through", () => {
    expect(consentFormProblem(form)).toBeNull();
  });

  it("refuses a username the API would refuse", () => {
    expect(consentFormProblem({ ...form, username: "no" })?.field).toBe(
      "username",
    );
    expect(consentFormProblem({ ...form, username: "has space" })?.field).toBe(
      "username",
    );
  });

  // Mutation: set retry: true on a form problem and the banner offers "Try
  // again" for a missing tick, which retrying cannot fix.
  it("needs the terms ticked, and a retry cannot help", () => {
    const problem = consentFormProblem({ ...form, agreed: false });
    expect(problem?.field).toBe("form");
    expect(problem?.retry).toBe(false);
    expect(consentFormProblem({ ...form, ageConfirmed: false })?.retry).toBe(
      false,
    );
    expect(consentFormProblem({ ...form, username: "no" })?.retry).toBe(false);
  });

  it("needs the age confirmed", () => {
    expect(
      consentFormProblem({ ...form, ageConfirmed: false })?.message,
    ).toMatch(/18/);
  });
});

describe("consentFormProblem, a returning user", () => {
  it("is asked only to agree, whatever the username and age fields hold", () => {
    const form = {
      newAccount: false,
      username: "",
      agreed: true,
      ageConfirmed: false,
    };
    expect(consentFormProblem(form)).toBeNull();
    expect(consentFormProblem({ ...form, agreed: false })?.message).toMatch(
      /updated terms/,
    );
  });
});

describe("consentSubmitFailure", () => {
  const taken = new ApiError(
    409,
    "/users/me",
    "PATCH",
    "That username is taken.",
  );

  // Mutation: return field "form" (or retry: true) for a refused username and
  // it lands in the banner with a futile "Try again".
  it("puts a refused username under its field, without a retry", () => {
    for (const status of [400, 409]) {
      const err = new ApiError(status, "/users/me", "PATCH", "Nope.");
      expect(consentSubmitFailure(err, true)).toEqual({
        field: "username",
        message: "Nope.",
        retry: false,
      });
    }
  });

  // Mutation: drop the `newAccount` test and a returning user's 400 is
  // blamed on a username field that is not on screen.
  it("leaves a returning user's refusal in the banner", () => {
    expect(consentSubmitFailure(taken, false).field).toBe("form");
  });

  // Mutation: widen the status test to 5xx and an outage is blamed on the name.
  it("offers retry for a request that failed", () => {
    const down = new ApiError(503, "/users/me", "PATCH");
    expect(consentSubmitFailure(down, true)).toMatchObject({
      field: "form",
      retry: true,
    });
    expect(consentSubmitFailure(new TypeError("offline"), true).retry).toBe(
      true,
    );
  });
});
