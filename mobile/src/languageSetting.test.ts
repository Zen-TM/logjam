import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Starting in the right language and choosing another (languageSetting.ts).
// Shared reads the simulated-regions switch and the language when it loads, so
// each test loads its own copy with them set.
const prefs = vi.hoisted(() => new Map<string, string>());
const writeOk = vi.hoisted(() => ({ value: true }));
vi.mock("./prefsDb", () => ({
  readPref: (key: string) => prefs.get(key) ?? null,
  writePref: (key: string, value: string) => {
    if (!writeOk.value) return false;
    prefs.set(key, value);
    return true;
  },
}));
const constants = vi.hoisted(() => ({
  get: (): { localeIdentifier?: string } => ({ localeIdentifier: "en_US" }),
}));
vi.mock("react-native", () => ({
  I18nManager: { getConstants: () => constants.get() },
}));
const reloadAsync = vi.hoisted(() => vi.fn());
vi.mock("expo-updates", () => ({ reloadAsync }));

const globals = globalThis as {
  LOGJAM_LANGUAGE?: string;
  LOGJAM_SIM_REGIONS?: boolean;
};

beforeEach(() => {
  writeOk.value = true;
  constants.get = () => ({ localeIdentifier: "en_US" });
  reloadAsync.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  prefs.clear();
  delete globals.LOGJAM_LANGUAGE;
  delete globals.LOGJAM_SIM_REGIONS;
});

async function load({
  sim = false,
  running,
}: {
  sim?: boolean;
  running?: string;
} = {}) {
  vi.resetModules();
  if (sim) globals.LOGJAM_SIM_REGIONS = true;
  if (running) globals.LOGJAM_LANGUAGE = running;
  return import("./languageSetting");
}

describe("reconcileLanguage", () => {
  // Mutation: pass every language in `LANGUAGES` in place of `offeredHere()` to
  // `languageToStart` in reconcileLanguage (a prod phone set to US English
  // would restart into a language prod does not offer).
  it("changes nothing in prod, whatever the phone speaks", async () => {
    const { reconcileLanguage } = await load({ sim: false });
    const restart = vi.fn().mockResolvedValue(undefined);
    expect(reconcileLanguage(["en-US"], restart)).toBe(false);
    expect(restart).not.toHaveBeenCalled();
    expect(prefs.get("language")).toBeUndefined();
  }, 30_000);

  // Mutation: delete the `writePref(...)` call, or the `restart()` call, in reconcileLanguage.
  it("stores the language the phone speaks, once offered, and restarts", async () => {
    const { reconcileLanguage } = await load({ sim: true });
    const restart = vi.fn().mockResolvedValue(undefined);
    expect(reconcileLanguage(["en_US"], restart)).toBe(true);
    expect(prefs.get("language")).toBe("en-US");
    expect(restart).toHaveBeenCalledTimes(1);
  }, 30_000);

  // Mutation: restart whatever `languageToStart` says in reconcileLanguage (a
  // phone already in its language would restart on every launch).
  it("does not restart a phone that already runs the language it should", async () => {
    prefs.set("language", "en-US");
    const { reconcileLanguage } = await load({ sim: true, running: "en-US" });
    const restart = vi.fn().mockResolvedValue(undefined);
    expect(reconcileLanguage(["en_US"], restart)).toBe(false);
    expect(restart).not.toHaveBeenCalled();
  }, 30_000);

  // Mutation: delete the `|| !writePref(...)` test in reconcileLanguage (a phone
  // that will not store it would restart on every launch, forever).
  it("does not restart when the phone will not store it", async () => {
    writeOk.value = false;
    const { reconcileLanguage } = await load({ sim: true });
    const restart = vi.fn().mockResolvedValue(undefined);
    expect(reconcileLanguage(["en_US"], restart)).toBe(false);
    expect(restart).not.toHaveBeenCalled();
  }, 30_000);

  // Mutation: delete `.catch(console.error)` in reconcileLanguage (a dev build,
  // whose restart rejects, would raise an unhandled rejection at launch).
  it("goes on when the restart fails, as in a dev build", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { reconcileLanguage } = await load({ sim: true });
    const restart = vi.fn().mockRejectedValue(new Error("updates are off"));
    expect(reconcileLanguage(["en_US"], restart)).toBe(true);
    await vi.waitFor(() => expect(error).toHaveBeenCalled());
  }, 30_000);

  // Mutation: pass `true` in place of `offersPseudoLanguage()` in `offeredHere`
  // (a pseudo-language kept from a development build would stay on where it
  // is not offered).
  it("moves a kept pseudo-language back to the source where it is not offered", async () => {
    prefs.set("language", "en-XA");
    const { reconcileLanguage } = await load({ sim: false, running: "en-XA" });
    const restart = vi.fn().mockResolvedValue(undefined);
    expect(reconcileLanguage([], restart)).toBe(true);
    expect(prefs.get("language")).toBe("en-AU");
  }, 30_000);
});

describe("deviceLanguages", () => {
  // Mutation: return `[]` in place of `[id]` in deviceLanguages.
  it("is the phone's locale identifier", async () => {
    const { deviceLanguages } = await load();
    expect(deviceLanguages()).toEqual(["en_US"]);
  }, 30_000);

  // Mutation: remove the try/catch, or the `id ? … : []` test, in deviceLanguages.
  it("is empty when the phone will not say", async () => {
    const { deviceLanguages } = await load();
    constants.get = () => ({});
    expect(deviceLanguages()).toEqual([]);
    constants.get = () => {
      throw new Error("no constants");
    };
    expect(deviceLanguages()).toEqual([]);
  }, 30_000);
});

describe("chooseLanguage", () => {
  // Mutation: delete the `writePref(...)` call, or the `restart()` call, in chooseLanguage.
  it("stores an offered language and restarts", async () => {
    const { chooseLanguage } = await load({ sim: true });
    const restart = vi.fn().mockResolvedValue(undefined);
    expect(await chooseLanguage("en-XA", restart)).toBe("restarting");
    expect(prefs.get("language")).toBe("en-XA");
    expect(restart).toHaveBeenCalledTimes(1);
  }, 30_000);

  // Mutation: delete `!offeredHere().includes(next) ||` in chooseLanguage.
  it("refuses a language this phone does not offer", async () => {
    const { chooseLanguage } = await load({ sim: false });
    const restart = vi.fn().mockResolvedValue(undefined);
    expect(await chooseLanguage("en-XA", restart)).toBe("refused");
    expect(prefs.get("language")).toBeUndefined();
    expect(restart).not.toHaveBeenCalled();
  }, 30_000);

  // Mutation: ignore `writePref`'s answer in chooseLanguage.
  it("refuses, without restarting, when the phone will not store it", async () => {
    writeOk.value = false;
    const { chooseLanguage } = await load({ sim: true });
    const restart = vi.fn().mockResolvedValue(undefined);
    expect(await chooseLanguage("en-US", restart)).toBe("refused");
    expect(restart).not.toHaveBeenCalled();
  }, 30_000);

  // Mutation: return "restarting" from the catch in chooseLanguage (a dev
  // build would claim a restart that never came).
  it("says it is stored for the next launch when the restart fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { chooseLanguage } = await load({ sim: true });
    const restart = vi.fn().mockRejectedValue(new Error("updates are off"));
    expect(await chooseLanguage("en-US", restart)).toBe("stored");
    expect(prefs.get("language")).toBe("en-US");
  }, 30_000);
});

describe("languageRow", () => {
  // Mutation: change `offered.length < 2` to `offered.length < 1` in languageRow
  // (prod would draw a choice of one).
  it("is not drawn with one language offered, recording or not", async () => {
    const { languageRow, offeredHere } = await load({ sim: false });
    expect(offeredHere()).toEqual(["en-AU"]);
    expect(languageRow(offeredHere(), [])).toBeNull();
    expect(languageRow(["en-AU"], [{ state: "recording" }])).toBeNull();
  }, 30_000);

  // Mutation: return `heldReason: null` always in languageRow (a restart would
  // interrupt a recording).
  it("is held while a track records, with the reason", async () => {
    const { languageRow } = await load({ sim: true });
    const { LANGUAGE_SETTING } = await import("@logjam/shared");
    const offered = ["en-AU", "en-US"] as const;
    expect(languageRow(offered, [{ state: "recording" }])?.heldReason).toBe(
      LANGUAGE_SETTING.held,
    );
  }, 30_000);

  // Mutation: test `track.state !== "done"` in place of `=== "recording"` in
  // languageRow (a paused or finished track would hold it).
  it("is open when no track is recording", async () => {
    const { languageRow } = await load({ sim: true });
    const offered = ["en-AU", "en-US"] as const;
    expect(languageRow(offered, [])?.heldReason).toBeNull();
    expect(
      languageRow(offered, [{ state: "paused" }, { state: "done" }])
        ?.heldReason,
    ).toBeNull();
  }, 30_000);
});
