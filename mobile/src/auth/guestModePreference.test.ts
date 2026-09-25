import { beforeEach, describe, expect, it, vi } from "vitest";

// prefsDb reaches for expo-sqlite, which throws outside a native runtime. An
// in-memory stand-in keeps this a pure test of the tri-state mapping — the part
// that decides which screen a cold start lands on.
const store = new Map<string, string>();
vi.mock("../prefsDb", () => ({
  readPref: (key: string) => store.get(key) ?? null,
  writePref: (key: string, value: string) => {
    store.set(key, value);
    return true;
  },
}));

const { clearEntryChoice, readEntryChoice, writeEntryChoice } = await import(
  "./guestModePreference"
);

describe("entry choice", () => {
  beforeEach(() => store.clear());

  // The distinction the whole chooser depends on: a fresh install has made no
  // choice, which is NOT the same as having chosen an account. Collapsing the
  // two puts the sign-in wall back in front of an app that doesn't need one.
  it("reads as unchosen on a fresh install", () => {
    expect(readEntryChoice()).toBe("unchosen");
  });

  it("round-trips both choices", () => {
    writeEntryChoice("guest");
    expect(readEntryChoice()).toBe("guest");
    writeEntryChoice("account");
    expect(readEntryChoice()).toBe("account");
  });

  // Sign-out's correctness rests on this: the device has no account on it
  // afterwards, so the next cold start must show the chooser, not sign-in.
  it("returns to unchosen when cleared", () => {
    writeEntryChoice("account");
    clearEntryChoice();
    expect(readEntryChoice()).toBe("unchosen");
  });

  it("treats an unrecognised stored value as unchosen", () => {
    store.set("guestMode", "yes-please");
    expect(readEntryChoice()).toBe("unchosen");
  });
});
