import { beforeEach, describe, expect, it, vi } from "vitest";
import { NSW_REGION, type Region } from "@logjam/shared";

const prefs = vi.hoisted(() => new Map<string, string>());
vi.mock("./prefsDb", () => ({
  readPref: (key: string) => prefs.get(key) ?? null,
  writePref: (key: string, value: string) => (prefs.set(key, value), true),
}));

const patch = vi.hoisted(() => vi.fn());
vi.mock("./api/apiFetch", () => ({ apiFetch: patch }));

// `normalizeRegionIds` drops ids it does not know, so a second region is
// pushed onto the fresh module's `REGIONS` for a choice to be more than the
// default.
const NZ = { ...NSW_REGION, id: "nz", name: "New Zealand" };
const load = async () => {
  vi.resetModules();
  ((await import("@logjam/shared")).REGIONS as Region[]).push(NZ);
  return import("./regionsPreference");
};

beforeEach(() => {
  prefs.clear();
  patch.mockReset().mockResolvedValue({});
});

describe("the chosen regions on Logjam GPS", () => {
  it("are NSW until chosen, and read back at the next launch", async () => {
    expect((await load()).readRegions()).toEqual(["nsw"]);
    prefs.set("regions", JSON.stringify(["nz"]));
    expect((await load()).readRegions()).toEqual(["nz"]);
    prefs.set("regions", "{not json");
    expect((await load()).readRegions()).toEqual(["nsw"]);
  });

  // Mutation: send the PATCH for a guest too (drop the `signedIn` check), and
  // a guest makes a server call (ADR 0007).
  it("keeps a guest's choice on the phone and sends nothing", async () => {
    const store = await load();
    expect(await store.chooseRegions(["nz"], false)).toBe(true);
    expect(store.readRegions()).toEqual(["nz"]);
    expect(JSON.parse(prefs.get("regions")!)).toEqual(["nz"]);
    expect(patch).not.toHaveBeenCalled();
  });

  // Mutation: drop the PATCH, and a choice made on the phone never reaches
  // the account or Logjam Web.
  it("sends a signed-in choice to the account", async () => {
    const store = await load();
    expect(await store.chooseRegions(["nsw", "nz"], true)).toBe(true);
    expect(patch).toHaveBeenCalledWith("/users/me", {
      method: "PATCH",
      body: { regions: ["nsw", "nz"] },
    });
    expect(store.readRegions()).toEqual(["nsw", "nz"]);
  });

  // Mutation: drop the `keep(before)` in the catch, and the phone offers
  // regions the account does not hold.
  it("puts the previous choice back when the send fails", async () => {
    const store = await load();
    patch.mockRejectedValue(new Error("offline"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await store.chooseRegions(["nz"], true)).toBe(false);
    expect(store.readRegions()).toEqual(["nsw"]);
  });

  it("are replaced by the account's, and by the default when it has none", async () => {
    const store = await load();
    await store.chooseRegions(["nz"], false);
    store.keepAccountRegions(["nsw"]);
    expect(store.readRegions()).toEqual(["nsw"]);
    store.keepAccountRegions(["nz"]);
    store.keepAccountRegions(undefined);
    expect(store.readRegions()).toEqual(["nsw"]);
  });

  // Mutation: drop forgetRegions() from the wipe (wipeLocalData.test.ts) or
  // make it keep the value, and the next account is offered this one's regions.
  it("go back to the default for the next account", async () => {
    const store = await load();
    await store.chooseRegions(["nz"], false);
    store.forgetRegions();
    expect(store.readRegions()).toEqual(["nsw"]);
    expect(JSON.parse(prefs.get("regions")!)).toEqual(["nsw"]);
  });
});
