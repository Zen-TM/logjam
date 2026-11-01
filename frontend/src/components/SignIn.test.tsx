import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

const oidc = vi.hoisted(() => ({
  hasCognitoAccount: vi.fn(() => true),
  signUp: vi.fn(async () => {}),
  confirmSignUp: vi.fn(async () => {}),
  resendSignUpCode: vi.fn(async () => {}),
  forgotPassword: vi.fn(async () => {}),
  confirmForgotPassword: vi.fn(async () => {}),
}));

const usernameAvailable = vi.hoisted(() => vi.fn(async () => true));

vi.mock("../auth/oidc", () => oidc);
vi.mock("../placeUtils", () => ({ usernameAvailable }));
vi.mock("./SignInTerrain", () => ({ default: () => null }));
vi.mock("./useSignInArea", () => ({ default: () => null }));
vi.mock("./Footer", () => ({ default: () => null }));

import SignIn from "./SignIn";

const onRedirect = vi.fn(async () => {});
const onPasswordSignIn = vi.fn(async () => {});

function draw(error: string | null = null) {
  render(
    <SignIn
      error={error}
      onRedirect={onRedirect}
      onPasswordSignIn={onPasswordSignIn}
    />,
  );
}

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(new RegExp(`^${label}`)), {
    target: { value },
  });
const press = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name }));

const EMAIL = "a@example.com";
const PASSWORD = "Aa1!aaaa";

function fillSignUp() {
  press("Sign up");
  type("Name", "A");
  type("Email", EMAIL);
  type("Username", "canyoneer");
  fireEvent.change(screen.getAllByLabelText(/password/i)[0], {
    target: { value: PASSWORD },
  });
  type("Confirm password", PASSWORD);
}

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  oidc.hasCognitoAccount.mockReturnValue(true);
  usernameAvailable.mockResolvedValue(true);
});

describe("SignIn under another issuer", () => {
  // Mutation: draw the forms for every issuer, and a provider that is not
  // Cognito gets fields nothing can submit.
  it("is one button and no field", () => {
    oidc.hasCognitoAccount.mockReturnValue(false);
    draw();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(document.querySelectorAll("input")).toHaveLength(0);
  });

  it("redirects on click and shows a failure above the button", () => {
    oidc.hasCognitoAccount.mockReturnValue(false);
    draw("Sign in failed. Please try again.");
    expect(screen.getByText("Sign in failed. Please try again.")).toBeTruthy();
    press("Sign in or create an account");
    expect(onRedirect).toHaveBeenCalledOnce();
  });
});

describe("SignIn under Cognito", () => {
  it("signs in from the page, with no redirect", async () => {
    draw();
    type("Email", EMAIL);
    type("Password", PASSWORD);
    press("Sign in");
    await waitFor(() =>
      expect(onPasswordSignIn).toHaveBeenCalledWith(EMAIL, PASSWORD),
    );
    expect(onRedirect).not.toHaveBeenCalled();
  });

  it("keeps the form and shows what Cognito refused", async () => {
    const refused = new Error("Incorrect username or password.");
    refused.name = "NotAuthorizedException";
    onPasswordSignIn.mockRejectedValueOnce(refused);
    draw();
    type("Email", EMAIL);
    type("Password", PASSWORD);
    press("Sign in");
    await screen.findByText("Incorrect username or password.");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
  });

  // Mutation: drop the branch, and someone who closed the tab before entering
  // their code is told to confirm with no way to.
  it("asks an unconfirmed account for a fresh code", async () => {
    const unconfirmed = new Error("User is not confirmed.");
    unconfirmed.name = "UserNotConfirmedException";
    onPasswordSignIn.mockRejectedValueOnce(unconfirmed);
    draw();
    type("Email", EMAIL);
    type("Password", PASSWORD);
    press("Sign in");
    await screen.findByLabelText(/^Verification code/);
    expect(oidc.resendSignUpCode).toHaveBeenCalledWith(EMAIL);
  });

  // Mutation: drop the check, and a bare Enter leaves the page for the
  // provider's.
  it("asks for a blank password instead of sending it", async () => {
    draw();
    type("Email", EMAIL);
    press("Sign in");
    await screen.findByText("Enter your password.");
    expect(onPasswordSignIn).not.toHaveBeenCalled();
  });

  // Mutation: drop either tick check in handleSignUp, and an account exists that
  // never agreed to the terms or confirmed its age on this form.
  it("will not sign up without the terms", async () => {
    draw();
    fillSignUp();
    fireEvent.click(screen.getByRole("checkbox", { name: /18 years/ }));
    press("Sign up");
    await screen.findByText(/Agree to the Terms of Use/);
    expect(oidc.signUp).not.toHaveBeenCalled();
  });

  it("will not sign up without the age", async () => {
    draw();
    fillSignUp();
    fireEvent.click(screen.getByRole("checkbox", { name: /agree to the/ }));
    press("Sign up");
    await screen.findByText(/18 or older/);
    expect(oidc.signUp).not.toHaveBeenCalled();
  });

  // Mutation: pass the username field instead of signedUpUsername, and consent
  // is recorded for ticks nobody made, on an account the form never signed up.
  it("records no consent for an account it did not sign up", async () => {
    const unconfirmed = new Error("User is not confirmed.");
    unconfirmed.name = "UserNotConfirmedException";
    onPasswordSignIn.mockRejectedValueOnce(unconfirmed);
    draw();
    press("Sign up");
    type("Username", "typed_not_sent");
    fireEvent.click(screen.getAllByRole("button", { name: "Sign in" })[0]);
    type("Email", EMAIL);
    type("Password", PASSWORD);
    press("Sign in");
    await screen.findByLabelText(/^Verification code/);
    type("Verification code", "123456");
    press("Verify");
    await waitFor(() =>
      expect(onPasswordSignIn).toHaveBeenLastCalledWith(
        EMAIL,
        PASSWORD,
        undefined,
      ),
    );
  });

  // Mutation: drop the check in handleSignUp, and someone learns the name is
  // taken only after the email code.
  it("stops a taken username before anything is sent to Cognito", async () => {
    usernameAvailable.mockResolvedValue(false);
    draw();
    fillSignUp();
    fireEvent.click(screen.getByRole("checkbox", { name: /agree to the/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /18 years/ }));
    press("Sign up");
    await screen.findByText("That username is taken. Choose another.");
    expect(oidc.signUp).not.toHaveBeenCalled();
    expect(usernameAvailable).toHaveBeenCalledWith("canyoneer");
  });

  it("says a username is taken on leaving the field", async () => {
    usernameAvailable.mockResolvedValue(false);
    draw();
    press("Sign up");
    type("Username", "canyoneer");
    fireEvent.blur(screen.getByLabelText(/^Username/));
    await screen.findByText("That username is taken. Choose another.");
  });

  // Mutation: drop the `usernameNow` comparison, and a late answer about the old
  // name lands under the new one.
  it("drops an answer about a name the field has moved on from", async () => {
    let answer: (free: boolean) => void = () => {};
    usernameAvailable.mockImplementationOnce(
      () => new Promise((resolve) => (answer = resolve)),
    );
    draw();
    press("Sign up");
    type("Username", "canyoneer");
    fireEvent.blur(screen.getByLabelText(/^Username/));
    type("Username", "canyoneer2");
    await act(async () => answer(false));
    expect(
      screen.queryByText("That username is taken. Choose another."),
    ).toBeNull();
  });

  it("signs a verified account in with the username it chose", async () => {
    draw();
    fillSignUp();
    fireEvent.click(screen.getByRole("checkbox", { name: /agree to the/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /18 years/ }));
    press("Sign up");
    await screen.findByLabelText("Verification code", { exact: false });
    expect(oidc.signUp).toHaveBeenCalledWith(EMAIL, PASSWORD, "A");
    type("Verification code", "123456");
    press("Verify");
    await waitFor(() =>
      expect(onPasswordSignIn).toHaveBeenCalledWith(
        EMAIL,
        PASSWORD,
        "canyoneer",
      ),
    );
    expect(oidc.confirmSignUp).toHaveBeenCalledWith(EMAIL, "123456");
  });

  it("resets a forgotten password on the page", async () => {
    draw();
    press("Forgot password?");
    type("Email", EMAIL);
    press("Send reset code");
    await screen.findByLabelText("Reset code", { exact: false });
    expect(oidc.forgotPassword).toHaveBeenCalledWith(EMAIL);
    type("Reset code", "123456");
    type("New password", PASSWORD);
    type("Confirm new password", PASSWORD);
    press("Reset password");
    await screen.findByText("Password reset — please sign in.");
    expect(oidc.confirmForgotPassword).toHaveBeenCalledWith(
      EMAIL,
      "123456",
      PASSWORD,
    );
  });
});
