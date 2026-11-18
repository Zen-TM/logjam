import { beforeEach, describe, expect, it, vi } from "vitest";

const prefs = vi.hoisted(() => new Map<string, string>());
const reads = vi.hoisted(() => ({ count: 0 }));
vi.mock("./prefsDb", () => ({
  readPref: (key: string) => (reads.count++, prefs.get(key) ?? null),
  writePref: (key: string, value: string) => (prefs.set(key, value), true),
}));

const patch = vi.hoisted(() => vi.fn());
vi.mock("./api/apiFetch", () => ({ apiFetch: patch }));

const load = async () => {
  vi.resetModules();
  return import("./unitsPreference");
};

beforeEach(() => {
  prefs.clear();
  reads.count = 0;
  patch.mockReset().mockResolvedValue({});
});

describe("the units chosen on Logjam GPS", () => {
  // Mutation: return a stored value that is not a units choice, or throw on
  // damaged JSON, and a bad pref string reaches the formatters.
  it.each([
    [undefined, null],
    [JSON.stringify("imperial"), "imperial"],
    [JSON.stringify("furlongs"), null],
    ["{not json", null],
  ])(
    "are read back at the next launch (stored %s)",
    async (stored, expected) => {
      if (stored !== undefined) prefs.set("units", stored);
      expect((await load()).readChosenUnits()).toBe(expected);
    },
  );

  // Mutation: memoise with `current ??= stored()`: nothing chosen is null, which
  // `??=` reads as unread, so prod (one region, never a choice) reads storage
  // on every render of the shell.
  it("reads storage once, whether or not a choice was kept", async () => {
    const store = await load();
    for (let i = 0; i < 3; i++) store.readChosenUnits();
    expect(reads.count).toBe(1);
  });

  // Mutation: send the PATCH for a guest too (drop the `signedIn` check), and
  // a guest makes a server call (ADR 0007).
  it("keeps a guest's choice on the phone and sends nothing", async () => {
    const store = await load();
    expect(await store.chooseUnits("imperial", false)).toBe(true);
    expect(store.readChosenUnits()).toBe("imperial");
    expect(JSON.parse(prefs.get("units")!)).toBe("imperial");
    expect(patch).not.toHaveBeenCalled();
  });

  // Mutation: drop the PATCH, or send another key, and a choice made on the
  // phone never reaches the account or Logjam Web.
  it("sends a signed-in choice to the account", async () => {
    const store = await load();
    expect(await store.chooseUnits("imperial", true)).toBe(true);
    expect(patch).toHaveBeenCalledWith("/users/me", {
      method: "PATCH",
      body: { units: "imperial" },
    });
    expect(store.readChosenUnits()).toBe("imperial");
  });

  // Mutation: drop `|| !choosesUnits(before, units)` from `chooseUnits`, and a
  // choice already stored is sent again; tapping the region's own units with
  // nothing stored is held to `choosesUnits` in shared/src/units.test.ts.
  it("stores a tap on the region's own units, and does nothing for a choice already stored", async () => {
    const store = await load();
    expect(await store.chooseUnits("metric", true)).toBe(true);
    expect(store.readChosenUnits()).toBe("metric");
    expect(patch).toHaveBeenCalledTimes(1);
    expect(await store.chooseUnits("metric", true)).toBe(true);
    expect(patch).toHaveBeenCalledTimes(1);
  });

  // Mutation: drop the `sending ||` in `chooseUnits`, and a second choice
  // while one is out is sent too and the first's late failure restores a
  // stale value; drop `setSending(false)` from the `finally`, and the row
  // stays held for good.
  it("refuses a choice while another is out, and a late failure restores only its own before", async () => {
    const store = await load();
    vi.spyOn(console, "error").mockImplementation(() => {});
    let fail!: () => void;
    patch.mockImplementationOnce(
      () => new Promise((_, reject) => (fail = () => reject(new Error("x")))),
    );
    const first = store.chooseUnits("imperial", true);
    expect(store.isSendingUnits()).toBe(true);
    expect(store.readChosenUnits()).toBe("imperial");
    expect(await store.chooseUnits("metric", true)).toBe(true);
    expect(patch).toHaveBeenCalledTimes(1);
    expect(store.readChosenUnits()).toBe("imperial");
    fail();
    expect(await first).toBe(false);
    expect(store.readChosenUnits()).toBeNull();
    expect(store.isSendingUnits()).toBe(false);
    expect(await store.chooseUnits("metric", true)).toBe(true);
    expect(patch).toHaveBeenCalledTimes(2);
    expect(store.isSendingUnits()).toBe(false);
  });

  // Mutation: drop the `keep(before)` in the catch, and the phone writes in
  // units the account does not hold.
  it("puts the previous choice back when the send fails", async () => {
    const store = await load();
    patch.mockRejectedValue(new Error("offline"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await store.chooseUnits("imperial", true)).toBe(false);
    expect(store.readChosenUnits()).toBeNull();
  });

  // Mutation: make `keepAccountUnits` ignore an absent value, and an account
  // that never chose inherits the last account's choice on this phone.
  it("takes the account's choice, absent included, and forgets it at sign-out", async () => {
    const store = await load();
    store.keepAccountUnits("imperial");
    expect(store.readChosenUnits()).toBe("imperial");
    store.keepAccountUnits(undefined);
    expect(store.readChosenUnits()).toBeNull();
    store.keepAccountUnits("imperial");
    store.forgetUnits();
    expect(store.readChosenUnits()).toBeNull();
    expect(JSON.parse(prefs.get("units")!)).toBeNull();
  });
});
