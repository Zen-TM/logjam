import { beforeEach, describe, expect, it, vi } from "vitest";

// A corrupt identity record must never read as "nobody signed in": that is the
// guest answer, and a guest keeps the data on the phone. The sign-in used to
// fold the two together, so a different user signing in over a corrupt record
// inherited the previous account's places.

const store: Record<string, string> = {};
vi.mock("expo-secure-store", () => ({
  getItemAsync: (key: string) => Promise.resolve(store[key] ?? null),
  setItemAsync: (key: string, value: string) => {
    store[key] = value;
    return Promise.resolve();
  },
  deleteItemAsync: (key: string) => {
    delete store[key];
    return Promise.resolve();
  },
}));

const { readPreviousIdentity, signInNeedsWipe, writeLocalIdentity } = await import(
  "./localIdentity"
);

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("readPreviousIdentity", () => {
  it("answers null when nobody has signed in", async () => {
    expect(await readPreviousIdentity()).toBeNull();
  });

  it("answers the record that is there", async () => {
    await writeLocalIdentity({ sub: "alice-sub", username: "alice" });
    expect(await readPreviousIdentity()).toEqual({ sub: "alice-sub", username: "alice" });
  });

  it("answers unreadable, not null, for a corrupt record", async () => {
    store.logjam_local_identity = "{not json";
    expect(await readPreviousIdentity()).toBe("unreadable");
    store.logjam_local_identity = JSON.stringify({ sub: 42 });
    expect(await readPreviousIdentity()).toBe("unreadable");
  });
});

describe("signInNeedsWipe", () => {
  const alice = { sub: "alice-sub", username: "alice" };

  it("keeps a guest's data when they link an account", () => {
    expect(signInNeedsWipe(null, "alice-sub")).toBe(false);
  });

  it("keeps the data when the same account signs back in", () => {
    expect(signInNeedsWipe(alice, "alice-sub")).toBe(false);
  });

  it("wipes for a different account", () => {
    expect(signInNeedsWipe(alice, "bob-sub")).toBe(true);
  });

  it("wipes when the record cannot say whose data this is", () => {
    expect(signInNeedsWipe("unreadable", "alice-sub")).toBe(true);
  });
});
