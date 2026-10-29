import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import TripLogDialog from "./TripLogDialog";
import { ToastProvider } from "../feedback/ToastProvider";
import { CurrentUserIdContext } from "../../CurrentUserIdContext";
import {
  TRIP_DRAFT_STORAGE_KEY,
  writeTripDraft,
  type TripDraftForm,
} from "../../tripDraft";

vi.mock("../../placeUtils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../placeUtils")>()),
  getTripLog: vi.fn(),
}));

// jsdom has no matchMedia, ResizeObserver, scrollIntoView or modal <dialog>.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    disconnect() {}
  },
);
Element.prototype.scrollIntoView = () => {};
vi.stubGlobal("matchMedia", (query: string) => ({
  matches: false,
  media: query,
  addEventListener() {},
  removeEventListener() {},
}));
HTMLDialogElement.prototype.showModal = function () {
  this.open = true;
};
HTMLDialogElement.prototype.close = function () {
  this.open = false;
};

// The draft is place names and notes in localStorage, offered only to the user
// who wrote it (tripDraft.ts, frontend/AGENTS.md). Real jsdom storage; made-up
// text. Mutations, each run red:
//  - readTripDraft's `parsed?.ownerId !== ownerId` -> `parsed === null`
//    : (b) and the id-changes test in (c) go red.
//  - drop `|| !currentUserId` from the autosave guard: both id-null tests in
//    (c) go red (typing writes under no owner; the draft is cleared).
//  - drop the render-phase re-check (`draftCheckedFor !== currentUserId`):
//    the id-arrives and id-changes tests in (c) go red.
const FORM: TripDraftForm = {
  date: "2026-07-14",
  notes: "Cold swims, one hang re-rigged.",
  selectedPlaceIds: [],
  displayNameInput: "",
  selectedTypes: [],
  fieldValues: {},
  creating: null,
};

function tree(userId: string | null) {
  return (
    <ToastProvider>
      <CurrentUserIdContext.Provider value={userId}>
        <TripLogDialog
          open
          onClose={vi.fn()}
          onSaved={vi.fn()}
          places={[]}
          customFieldDefs={[]}
          onCustomFieldDefsChange={vi.fn()}
          existingTripTypes={[]}
        />
      </CurrentUserIdContext.Provider>
    </ToastProvider>
  );
}

const offer = () => screen.queryByText(/You have an unsaved trip/);
const slot = () => localStorage.getItem(TRIP_DRAFT_STORAGE_KEY);

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  writeTripDraft("alice", FORM, new Date());
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the trip draft offer", () => {
  it("(a) is shown to the user who wrote the draft", () => {
    render(tree("alice"));
    expect(offer()).not.toBeNull();
    expect(slot()).not.toBeNull();
  });

  it("(b) is not shown to another user, and the draft is removed", () => {
    render(tree("bob"));
    expect(offer()).toBeNull();
    expect(slot()).toBeNull();
  });

  it("(c) waits for the user: nothing is offered or written while the id is null", () => {
    const before = slot();
    render(tree(null));
    expect(offer()).toBeNull();
    fireEvent.change(screen.getByLabelText(/notes/i), {
      target: { value: "typed before the user loaded" },
    });
    act(() => void vi.advanceTimersByTime(10_000));
    expect(slot()).toBe(before);
  });

  it("(c) then offers the owner's draft when the id arrives, untouched by autosave", () => {
    const before = slot();
    const { rerender } = render(tree(null));
    act(() => void vi.advanceTimersByTime(10_000));
    rerender(tree("alice"));
    act(() => void vi.advanceTimersByTime(10_000));
    expect(offer()).not.toBeNull();
    expect(slot()).toBe(before);
  });

  it("(c) never offers one user's draft to the next while the id changes", () => {
    const { rerender } = render(tree("alice"));
    expect(offer()).not.toBeNull();
    rerender(tree(null));
    expect(offer()).toBeNull();
    rerender(tree("bob"));
    expect(offer()).toBeNull();
    expect(slot()).toBeNull();
  });
});
