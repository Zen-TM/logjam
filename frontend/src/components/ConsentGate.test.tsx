import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ApiError } from "../errors/ApiError";

const recordConsent = vi.hoisted(() => vi.fn());
vi.mock("../placeUtils", () => ({ recordConsent }));

import ConsentGate from "./ConsentGate";

const onAccepted = vi.fn();
const onSignOut = vi.fn();

function show(newAccount: boolean) {
  render(
    <ConsentGate
      consentVersion="2026-09-28"
      newAccount={newAccount}
      currentUsername="alice.k"
      onAccepted={onAccepted}
      onSignOut={onSignOut}
    />,
  );
}

const agree = () => fireEvent.click(screen.getByText("Agree and continue"));
const tick = (name: RegExp) => fireEvent.click(screen.getByLabelText(name));

beforeEach(() => {
  vi.clearAllMocks();
  recordConsent.mockResolvedValue({ id: "u1" });
});
afterEach(cleanup);

describe("ConsentGate for a returning user", () => {
  // Mutation: render the new-account fields for everyone and this goes red.
  it("is today's gate: updated terms, one tick, no username, no age", async () => {
    show(false);
    expect(screen.getByText("Updated terms")).toBeTruthy();
    expect(screen.queryByLabelText("Username")).toBeNull();
    expect(screen.queryByLabelText(/18 years/)).toBeNull();
    tick(/updated Terms/);
    agree();
    await vi.waitFor(() => expect(onAccepted).toHaveBeenCalled());
    expect(recordConsent).toHaveBeenCalledWith("2026-09-28");
  });
});

describe("ConsentGate for a new account", () => {
  it("welcomes, offers the current name, and asks for all three answers", () => {
    show(true);
    expect(screen.getByText("Welcome to Logjam")).toBeTruthy();
    expect(screen.queryByText("Updated terms")).toBeNull();
    expect((screen.getByLabelText("Username") as HTMLInputElement).value).toBe(
      "alice.k",
    );
    expect(screen.getByLabelText(/I agree to the Terms of Use/)).toBeTruthy();
    expect(screen.getByLabelText(/18 years/)).toBeTruthy();
  });

  // Mutation: drop the age check in handleAgree and this records consent.
  it("will not record consent until both ticks are given", () => {
    show(true);
    agree();
    expect(recordConsent).not.toHaveBeenCalled();
    tick(/I agree to the Terms of Use/);
    agree();
    expect(screen.getByText(/18 or older/)).toBeTruthy();
    expect(recordConsent).not.toHaveBeenCalled();
  });

  // Mutation: drop the isValidUsername check and the API's 400 is the only
  // thing that ever says so.
  it("holds a username the API would refuse, under the field", () => {
    show(true);
    fireEvent.change(screen.getByLabelText("Username"), {
      target: { value: "no spaces!" },
    });
    tick(/I agree to the Terms of Use/);
    tick(/18 years/);
    agree();
    expect(screen.getByText(/3 to 32 letters/)).toBeTruthy();
    expect(recordConsent).not.toHaveBeenCalled();
  });

  it("sends the trimmed username with the consent", async () => {
    show(true);
    fireEvent.change(screen.getByLabelText("Username"), {
      target: { value: " bob_the-1 " },
    });
    tick(/I agree to the Terms of Use/);
    tick(/18 years/);
    agree();
    await vi.waitFor(() => expect(onAccepted).toHaveBeenCalled());
    expect(recordConsent).toHaveBeenCalledWith("2026-09-28", "bob_the-1");
  });

  it("shows the API's message for a taken username and stays", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    recordConsent.mockRejectedValue(
      new ApiError(
        409,
        "/users/me",
        "PATCH",
        "That username is taken. Choose another.",
      ),
    );
    show(true);
    tick(/I agree to the Terms of Use/);
    tick(/18 years/);
    agree();
    await screen.findByText("That username is taken. Choose another.");
    expect(onAccepted).not.toHaveBeenCalled();
  });
});
