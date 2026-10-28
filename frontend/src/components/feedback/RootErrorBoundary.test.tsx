import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { RootErrorBoundary } from "./RootErrorBoundary";

// A render throw is not something a live run waits for; the suite causes it to
// verify that the boundary replaces a thrown render with a recovery surface.
//
// The fallback is the last screen anyone sees during a crash loop, so what it
// owes the reader is checked here rather than left to the next incident: it
// announces itself, it names the two ways out, and Sign out does the same
// session cleanup as the app's own sign-out rather than a bare reload.

const mocks = vi.hoisted(() => ({
  signOut: vi.fn(async () => {}),
  clearTripDraft: vi.fn(),
  clearTileCache: vi.fn(async () => {}),
  reload: vi.fn(),
}));

vi.mock("aws-amplify/auth", () => ({ signOut: mocks.signOut }));
vi.mock("../../tripDraft", () => ({ clearTripDraft: mocks.clearTripDraft }));
vi.mock("../../geoPdf/cache", () => ({
  clearTileCache: mocks.clearTileCache,
}));

function Thrower(): never {
  throw new Error("render exploded");
}

beforeEach(() => {
  mocks.signOut.mockClear();
  mocks.clearTripDraft.mockClear();
  mocks.clearTileCache.mockClear();
  mocks.reload.mockClear();
  // jsdom cannot navigate: give the recovery verbs somewhere to land.
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { reload: mocks.reload },
  });
  // React logs the caught error itself; the boundary's own line is asserted
  // below, and the rest would only be noise.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("RootErrorBoundary", () => {
  it("replaces a thrown render with the recovery surface, not a blank page", () => {
    render(
      <RootErrorBoundary>
        <Thrower />
      </RootErrorBoundary>,
    );

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Something went wrong" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
    // A render error and a component stack carry no user data (privacy rule).
    expect(console.error).toHaveBeenCalledWith(
      "Unhandled render error:",
      expect.any(Error),
      expect.anything(),
    );
  });

  it("renders children untouched when nothing throws", () => {
    render(
      <RootErrorBoundary>
        <p>the app</p>
      </RootErrorBoundary>,
    );

    expect(screen.getByText("the app")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("signs out through the same flow the app does, then reloads", async () => {
    render(
      <RootErrorBoundary>
        <Thrower />
      </RootErrorBoundary>,
    );

    screen.getByRole("button", { name: "Sign out" }).click();

    // The draft must not outlive the session down ANY exit, and this exit
    // bypasses useAuth — which is why it repeats the clear.
    await vi.waitFor(() => expect(mocks.clearTripDraft).toHaveBeenCalled());
    // Mutation: drop the clearTileCache call in handleSignOut.
    await vi.waitFor(() => expect(mocks.clearTileCache).toHaveBeenCalled());
    await vi.waitFor(() => expect(mocks.signOut).toHaveBeenCalled());
    await vi.waitFor(() => expect(mocks.reload).toHaveBeenCalled());
  });

  it("reloads even when signing out fails, so a corrupt session is still escapable", async () => {
    mocks.signOut.mockRejectedValueOnce(new Error("fake auth has no Amplify"));
    render(
      <RootErrorBoundary>
        <Thrower />
      </RootErrorBoundary>,
    );

    screen.getByRole("button", { name: "Sign out" }).click();

    await vi.waitFor(() => expect(mocks.reload).toHaveBeenCalled());
  });
});
