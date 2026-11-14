import { readFileSync } from "node:fs";
import { join } from "node:path";
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
const findActiveTrack = vi.hoisted(() => vi.fn());
vi.mock("./tracks/tracksDb", () => ({ findActiveTrack }));

const globals = globalThis as {
  LOGJAM_LANGUAGE?: string;
  LOGJAM_SIM_REGIONS?: boolean;
};

beforeEach(() => {
  writeOk.value = true;
  constants.get = () => ({ localeIdentifier: "en_US" });
  reloadAsync.mockReset().mockResolvedValue(undefined);
  findActiveTrack.mockReset().mockResolvedValue(null);
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
    expect(await reconcileLanguage({ device: ["en-US"], restart })).toBe(false);
    expect(restart).not.toHaveBeenCalled();
    expect(prefs.get("language")).toBeUndefined();
  }, 30_000);

  // Mutation: delete the `writePref(...)` call, or the `restart()` call, in reconcileLanguage.
  it("stores the language the phone speaks, once offered, and restarts", async () => {
    const { reconcileLanguage } = await load({ sim: true });
    const restart = vi.fn().mockResolvedValue(undefined);
    expect(await reconcileLanguage({ device: ["en_US"], restart })).toBe(true);
    expect(prefs.get("language")).toBe("en-US");
    expect(restart).toHaveBeenCalledTimes(1);
  }, 30_000);

  // Mutation: restart whatever `languageToStart` says in reconcileLanguage (a
  // phone already in its language would restart on every launch).
  it("does not restart a phone that already runs the language it should", async () => {
    prefs.set("language", "en-US");
    const { reconcileLanguage } = await load({ sim: true, running: "en-US" });
    const restart = vi.fn().mockResolvedValue(undefined);
    expect(await reconcileLanguage({ device: ["en_US"], restart })).toBe(false);
    expect(restart).not.toHaveBeenCalled();
  }, 30_000);

  // Mutation: delete the `isRecording()` test in reconcileLanguage (a restart
  // would interrupt a recording).
  it("does not restart, or store, while a track records: it applies at the next start", async () => {
    findActiveTrack.mockResolvedValue({ state: "recording" });
    const { reconcileLanguage } = await load({ sim: true });
    const restart = vi.fn().mockResolvedValue(undefined);
    expect(await reconcileLanguage({ device: ["en_US"], restart })).toBe(false);
    expect(restart).not.toHaveBeenCalled();
    expect(prefs.get("language")).toBeUndefined();
  }, 30_000);

  // Mutation: test `!== null` in place of `=== "recording"` in `trackRecording`
  // (a paused track would hold the restart for ever).
  it("restarts with a paused track, which is not recording", async () => {
    findActiveTrack.mockResolvedValue({ state: "paused" });
    const { reconcileLanguage } = await load({ sim: true });
    const restart = vi.fn().mockResolvedValue(undefined);
    expect(await reconcileLanguage({ device: ["en_US"], restart })).toBe(true);
  }, 30_000);

  // Mutation: remove the try/catch round `isRecording()` in reconcileLanguage
  // (a track list that cannot be read would restart over a recording, or reject).
  it("does not restart when the track list cannot be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    findActiveTrack.mockRejectedValue(new Error("db closed"));
    const { reconcileLanguage } = await load({ sim: true });
    const restart = vi.fn().mockResolvedValue(undefined);
    expect(await reconcileLanguage({ device: ["en_US"], restart })).toBe(false);
    expect(restart).not.toHaveBeenCalled();
  }, 30_000);

  // Mutation: delete the `!writePref(...)` test in reconcileLanguage (a phone
  // that will not store it would restart on every launch, forever).
  it("does not restart when the phone will not store it", async () => {
    writeOk.value = false;
    const { reconcileLanguage } = await load({ sim: true });
    const restart = vi.fn().mockResolvedValue(undefined);
    expect(await reconcileLanguage({ device: ["en_US"], restart })).toBe(false);
    expect(restart).not.toHaveBeenCalled();
  }, 30_000);

  // Mutation: delete `.catch(console.error)` in reconcileLanguage (a dev build,
  // whose restart rejects, would raise an unhandled rejection at launch).
  it("goes on when the restart fails, as in a dev build", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { reconcileLanguage } = await load({ sim: true });
    const restart = vi.fn().mockRejectedValue(new Error("updates are off"));
    expect(await reconcileLanguage({ device: ["en_US"], restart })).toBe(true);
    await vi.waitFor(() => expect(error).toHaveBeenCalled());
  }, 30_000);

  // Mutation: pass every language in `LANGUAGES` in place of `offeredHere()` to
  // `languageToStart` in reconcileLanguage (a pseudo-language kept from a
  // development build would stay on where it is not offered).
  it("moves a kept pseudo-language back to the source where it is not offered", async () => {
    prefs.set("language", "en-XA");
    const { reconcileLanguage } = await load({ sim: false, running: "en-XA" });
    const restart = vi.fn().mockResolvedValue(undefined);
    expect(await reconcileLanguage({ device: [], restart })).toBe(true);
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

  // Mutation: delete the `changesLanguage` line in chooseLanguage (a re-tap of
  // the language already running would store it and restart for no change).
  it("does nothing for the language already running", async () => {
    const { chooseLanguage } = await load({ sim: true, running: "en-US" });
    const restart = vi.fn().mockResolvedValue(undefined);
    expect(await chooseLanguage("en-US", restart)).toBe("unchanged");
    expect(prefs.get("language")).toBeUndefined();
    expect(restart).not.toHaveBeenCalled();
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
  const TWO = ["en-AU", "en-US"] as const;

  // Mutation: replace `showsLanguageChoice(offered)` with `true` in languageRow
  // (prod would draw a choice of one).
  it("is not drawn with one language offered, recording or not", async () => {
    const { languageRow } = await load({ sim: false });
    const { offeredHere } = await import("@logjam/shared");
    expect(offeredHere()).toEqual(["en-AU"]);
    expect(languageRow(offeredHere(), [], true)).toBeNull();
    expect(languageRow(["en-AU"], [{ state: "recording" }], true)).toBeNull();
  }, 30_000);

  // Mutation: return `heldReason: null` always in languageRow (a restart would
  // interrupt a recording).
  it("is held while a track records, with the reason", async () => {
    const { languageRow } = await load({ sim: true });
    const { LANGUAGE_SETTING } = await import("@logjam/shared");
    expect(languageRow(TWO, [{ state: "recording" }], true)?.heldReason).toBe(
      LANGUAGE_SETTING.held,
    );
  }, 30_000);

  // Mutation: delete `!tracksLoaded ||` in languageRow (the row would be
  // tappable while a recording is still being looked for, or for good when the
  // list cannot be read).
  it("is held until the track list has been read", async () => {
    const { languageRow } = await load({ sim: true });
    const { LANGUAGE_SETTING } = await import("@logjam/shared");
    expect(languageRow(TWO, [], false)?.heldReason).toBe(LANGUAGE_SETTING.held);
  }, 30_000);

  // Mutation: test `track.state !== "done"` in place of `=== "recording"` in
  // languageRow (a paused or finished track would hold it).
  it("is open when the list is read and no track is recording", async () => {
    const { languageRow } = await load({ sim: true });
    expect(languageRow(TWO, [], true)?.heldReason).toBeNull();
    expect(
      languageRow(TWO, [{ state: "paused" }, { state: "done" }], true)
        ?.heldReason,
    ).toBeNull();
  }, 30_000);
});

describe("languageToSend", () => {
  const CURRENT = "2026-11-02";
  const settled = (language?: string) => ({
    id: "u",
    consentVersion: CURRENT,
    uiPreferences: language ? { language } : null,
  });
  const ask = (over: Record<string, unknown> = {}) => ({
    accountState: "linked" as const,
    user: settled() as never,
    consented: false,
    newAccount: false,
    running: "en-US" as const,
    ...over,
  });

  // Mutation: delete the `capabilityStatus("serverPrefs", …)` test in
  // languageToSend (a guest would send to an account it does not have: ADR 0007).
  it("sends nothing for a guest, whatever the phone runs", async () => {
    const { languageToSend } = await load();
    expect(languageToSend(ask({ accountState: "guest" }))).toBeNull();
    expect(
      languageToSend(ask({ accountState: "guest", running: "en-XA" })),
    ).toBeNull();
  }, 30_000);

  // Mutation: delete `if (!user) return null;` in languageToSend.
  it("sends nothing before the account has loaded", async () => {
    const { languageToSend } = await load();
    expect(languageToSend(ask({ user: undefined }))).toBeNull();
    expect(languageToSend(ask({ user: null }))).toBeNull();
  }, 30_000);

  // Mutation: delete `if (!consented && needsReconsent(user)) return null;` in languageToSend
  // (the PATCH would fire behind the consent gate).
  it("sends nothing while consent is missing or stale", async () => {
    const { languageToSend } = await load();
    const missing = { ...settled(), consentVersion: null } as never;
    const stale = { ...settled(), consentVersion: "2000-01-01" } as never;
    expect(languageToSend(ask({ user: missing }))).toBeNull();
    expect(languageToSend(ask({ user: stale }))).toBeNull();
  }, 30_000);

  // Mutation: test `needsReconsent(user)` alone, dropping `!consented &&`, in
  // languageToSend (a stale account that has just agreed would send nothing).
  it("sends once the gate has been passed in this session, though the record is still stale", async () => {
    const { languageToSend } = await load();
    const stale = { ...settled(), consentVersion: "2000-01-01" } as never;
    expect(languageToSend(ask({ user: stale, consented: true }))).toBe("en-US");
  }, 30_000);

  // Mutation: delete `if (showsRegionStep(newAccount)) return null;` in
  // languageToSend (the PATCH could race the region step's own).
  it("sends nothing while the new-account region step shows, and sends after", async () => {
    const { languageToSend } = await load({ sim: true });
    expect(languageToSend(ask({ newAccount: true }))).toBeNull();
    expect(languageToSend(ask({ newAccount: false }))).toBe("en-US");
  }, 30_000);

  // Mutation: return null in place of `languageToRecord(…)` in languageToSend.
  it("sends the running language to a settled account whose record differs", async () => {
    const { languageToSend } = await load();
    expect(languageToSend(ask())).toBe("en-US");
    expect(
      languageToSend(ask({ user: settled("en-US"), running: "en-AU" })),
    ).toBe("en-AU");
  }, 30_000);

  // Mutation: return `running` in place of `languageToRecord(…)` in languageToSend
  // (a phone in the source language would write to an account with none).
  it("sends nothing from the source language to an account with none", async () => {
    const { languageToSend } = await load();
    expect(languageToSend(ask({ running: "en-AU" }))).toBeNull();
  }, 30_000);
});

describe("the Display screen", () => {
  // Mutation: call `useTracks()` in DisplaySettingsScreen itself, outside
  // `LanguageRow` (prod would read the track table for a row it never draws).
  it("reads no tracks itself: only the language row does", () => {
    const source = readFileSync(
      join(__dirname, "screens/settings/DisplaySettingsScreen.tsx"),
      "utf8",
    );
    const [screen, row] = source.split("function LanguageRow(");
    // The floor: the child exists and is where the read is.
    expect(row).toMatch(/useTracks\(\)/);
    expect(screen.match(/useTracks\(\)/g) ?? []).toHaveLength(0);
    expect(screen).toContain("showsLanguageChoice(offered)");
  });
});
