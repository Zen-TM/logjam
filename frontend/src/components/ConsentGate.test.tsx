import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ApiError } from "../errors/ApiError";

const recordConsent = vi.hoisted(() => vi.fn());
const updateUserPreferences = vi.hoisted(() => vi.fn());
vi.mock("../placeUtils", () => ({ recordConsent, updateUserPreferences }));

import {
  NSW_REGION,
  REGION_CHOICE,
  regionChoiceProblem,
  type Region,
} from "@logjam/shared";
import ConsentGate from "./ConsentGate";

const TWO_REGIONS: Region[] = [
  NSW_REGION,
  {
    ...NSW_REGION,
    id: "nz",
    name: "New Zealand",
    basemaps: [],
    defaultBasemap: "osm-topo",
  },
];

const onAccepted = vi.fn();
const onSignOut = vi.fn();

function show(newAccount: boolean, regions?: readonly Region[]) {
  render(
    <ConsentGate
      consentVersion="2026-09-28"
      newAccount={newAccount}
      currentUsername="alice.k"
      onAccepted={onAccepted}
      onSignOut={onSignOut}
      regions={regions}
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
    expect(screen.queryByLabelText(/18 or older/)).toBeNull();
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
    expect(screen.getByLabelText(/18 or older/)).toBeTruthy();
  });

  // Mutation: drop the age check in handleAgree and this records consent.
  it("will not record consent until both ticks are given", () => {
    show(true);
    agree();
    expect(recordConsent).not.toHaveBeenCalled();
    tick(/I agree to the Terms of Use/);
    agree();
    expect(screen.getByText(/Confirm you are 18 or older/)).toBeTruthy();
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
    tick(/18 or older/);
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
    tick(/18 or older/);
    agree();
    await vi.waitFor(() => expect(onAccepted).toHaveBeenCalled());
    expect(recordConsent).toHaveBeenCalledWith("2026-09-28", "bob_the-1");
  });

  // Mutation: send the refusal to the banner (setError) and it has a retry
  // button and sits away from the field; drop the clear-on-edit and it stays.
  it("shows the API's message for a taken username under the field, clearing on edit", async () => {
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
    tick(/18 or older/);
    agree();
    await screen.findByText("That username is taken. Choose another.");
    expect(onAccepted).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: /retry|try again/i }),
    ).toBeNull();
    fireEvent.change(screen.getByLabelText("Username"), {
      target: { value: "other" },
    });
    expect(
      screen.queryByText("That username is taken. Choose another."),
    ).toBeNull();
  });
});

const signUp = (regions?: readonly Region[]) => {
  show(true, regions);
  tick(/I agree to the Terms of Use/);
  tick(/18 or older/);
  agree();
};

describe("the region step", () => {
  // Mutation: call onAccepted straight after recordConsent and the step never
  // shows; drop the `offersRegionChoice` check and one region shows it too.
  it("follows the terms for a new account when there is a second region", async () => {
    signUp(TWO_REGIONS);
    await screen.findByText(REGION_CHOICE.title);
    expect(screen.getByLabelText("NSW")).toBeTruthy();
    expect(screen.getByLabelText("New Zealand")).toBeTruthy();
    expect(onAccepted).not.toHaveBeenCalled();
  });

  it("is not there with one region", async () => {
    signUp([NSW_REGION]);
    await vi.waitFor(() => expect(onAccepted).toHaveBeenCalled());
    expect(screen.queryByText(REGION_CHOICE.title)).toBeNull();
    expect(updateUserPreferences).not.toHaveBeenCalled();
  });

  // Mutation: show the step to a returning user and this goes red.
  it("is not asked of a returning user", async () => {
    show(false, TWO_REGIONS);
    tick(/updated Terms/);
    agree();
    await vi.waitFor(() => expect(onAccepted).toHaveBeenCalled());
    expect(screen.queryByText(REGION_CHOICE.title)).toBeNull();
  });

  // Mutation: drop the problem check in handleRegions and an empty choice is
  // sent to the API.
  it("holds Continue with its reason until a region is ticked, then sends every ticked id", async () => {
    const saved = { id: "u1", uiPreferences: { regions: ["nsw", "nz"] } };
    updateUserPreferences.mockResolvedValue(saved);
    signUp(TWO_REGIONS);
    await screen.findByText(REGION_CHOICE.title);
    const next = () =>
      screen.getByRole("button", { name: REGION_CHOICE.continue });
    fireEvent.click(next());
    screen.getByText(regionChoiceProblem([])!);
    expect(updateUserPreferences).not.toHaveBeenCalled();

    tick(/^NSW$/);
    tick(/New Zealand/);
    expect(screen.queryByText(regionChoiceProblem([])!)).toBeNull();
    fireEvent.click(next());
    await vi.waitFor(() => expect(onAccepted).toHaveBeenCalledWith(saved));
    expect(updateUserPreferences).toHaveBeenCalledWith({
      regions: ["nsw", "nz"],
    });
  });

  // Mutation: swallow the error, or call onAccepted before the PATCH settles.
  it("says so and retries when the save fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    updateUserPreferences.mockRejectedValueOnce(new Error("offline"));
    updateUserPreferences.mockResolvedValue({ id: "u1" });
    signUp(TWO_REGIONS);
    await screen.findByText(REGION_CHOICE.title);
    tick(/New Zealand/);
    fireEvent.click(
      screen.getByRole("button", { name: REGION_CHOICE.continue }),
    );
    await screen.findByText(REGION_CHOICE.saveFailed);
    expect(onAccepted).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /retry|try again/i }));
    await vi.waitFor(() => expect(onAccepted).toHaveBeenCalled());
  });
});
