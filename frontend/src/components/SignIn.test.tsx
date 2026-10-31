import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("./SignInTerrain", () => ({ default: () => null }));
vi.mock("./useSignInArea", () => ({ default: () => null }));
vi.mock("./Footer", () => ({ default: () => null }));

import SignIn from "./SignIn";

afterEach(cleanup);

describe("SignIn", () => {
  // Mutation: put a password or email field back and Logjam Web handles a
  // password again.
  it("is one button and no field", () => {
    render(<SignIn error={null} onSignIn={async () => {}} />);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(document.querySelectorAll("input")).toHaveLength(0);
  });

  it("redirects on click and shows a failure above the button", async () => {
    const onSignIn = vi.fn(async () => {});
    render(
      <SignIn error="Sign in failed. Please try again." onSignIn={onSignIn} />,
    );
    expect(screen.getByText("Sign in failed. Please try again.")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Sign in or create an account" }),
    );
    expect(onSignIn).toHaveBeenCalledOnce();
  });
});
