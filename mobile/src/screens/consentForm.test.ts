// Guard: a new account cannot finish without a valid username, the terms and
// its age. Drop the `newAccount` username check, the age check, or the `agreed`
// check in consentFormProblem and the matching test goes red; apply the new-
// account questions to a returning user and the last test goes red.
import { describe, expect, it } from "vitest";

import { consentFormProblem } from "./consentForm";

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

  it("needs the terms ticked", () => {
    expect(consentFormProblem({ ...form, agreed: false })?.field).toBe("form");
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
