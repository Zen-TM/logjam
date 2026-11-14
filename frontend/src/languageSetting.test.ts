import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TUser } from "@logjam/shared";

// Starting in the right language, choosing another, recording it on the account
// (languageSetting.ts). Shared reads the simulated-regions switch and the
// language when it loads, so each test loads its own copy with them set.
const updateUserPreferences = vi.hoisted(() => vi.fn());
vi.mock("./placeUtils", () => ({ updateUserPreferences }));

const globals = globalThis as {
  LOGJAM_LANGUAGE?: string;
  LOGJAM_SIM_REGIONS?: boolean;
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  updateUserPreferences.mockReset();
  localStorage.clear();
  delete globals.LOGJAM_LANGUAGE;
  delete globals.LOGJAM_SIM_REGIONS;
  document.documentElement.lang = "en";
});

async function load({
  sim = false,
  device = ["en-US"],
  running,
}: {
  sim?: boolean;
  device?: string[];
  running?: string;
} = {}) {
  vi.resetModules();
  if (sim) globals.LOGJAM_SIM_REGIONS = true;
  if (running) globals.LOGJAM_LANGUAGE = running;
  vi.spyOn(navigator, "languages", "get").mockReturnValue(device);
  return import("./languageSetting");
}

describe("reconcileLanguage", () => {
  // Mutation: pass every language in `LANGUAGES` in place of `offeredHere()` to
  // `languageToStart` in reconcileLanguage (a prod browser that speaks en-US
  // would restart into a language prod does not offer).
  it("changes nothing in prod, whatever the browser speaks", async () => {
    const { reconcileLanguage } = await load({ sim: false });
    const reload = vi.fn();
    expect(reconcileLanguage(reload)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(localStorage.getItem("logjam.language")).toBeNull();
    expect(document.documentElement.lang).toBe("en-AU");
  }, 30_000);

  // Mutation: delete the `store(next)` call, or the `reload()` call, in reconcileLanguage.
  it("stores the language the browser speaks, once offered, and reloads", async () => {
    const { reconcileLanguage } = await load({ sim: true });
    const reload = vi.fn();
    expect(reconcileLanguage(reload)).toBe(true);
    expect(localStorage.getItem("logjam.language")).toBe("en-US");
    expect(reload).toHaveBeenCalledTimes(1);
  }, 30_000);

  // Mutation: reload whatever `languageToStart` says in reconcileLanguage (a
  // browser already in its language would reload on every start).
  it("does not reload a browser that already runs the language it should", async () => {
    localStorage.setItem("logjam.language", "en-US");
    const { reconcileLanguage } = await load({ sim: true, running: "en-US" });
    const reload = vi.fn();
    expect(reconcileLanguage(reload)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  }, 30_000);

  // Mutation: delete `document.documentElement.lang = language();`.
  it("sets <html lang> to the language running", async () => {
    const { reconcileLanguage } = await load({ sim: true, running: "en-US" });
    localStorage.setItem("logjam.language", "en-US");
    reconcileLanguage(vi.fn());
    expect(document.documentElement.lang).toBe("en-US");
  }, 30_000);

  // Mutation: remove the try/catch in `readStoredLanguage` (language.ts): a
  // browser that blocks site data would throw at Logjam Web's start and paint
  // nothing. Or replace `readStoredLanguage() === lang` with `true` in `store`:
  // a browser that takes the write but not the read would reload on every start.
  it("does not throw, or reload, when the browser refuses the read", async () => {
    const { reconcileLanguage } = await load({ sim: true });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    const reload = vi.fn();
    expect(() => reconcileLanguage(reload)).not.toThrow();
    expect(reload).not.toHaveBeenCalled();
  }, 30_000);

  // Mutation: delete the `|| !store(next)` test in reconcileLanguage (a browser
  // that refuses storage would reload on every start, forever).
  it("does not reload when the browser refuses the write", async () => {
    const { reconcileLanguage } = await load({ sim: true });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    const reload = vi.fn();
    expect(reconcileLanguage(reload)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  }, 30_000);

  // Mutation: pass every language in `LANGUAGES` in place of `offeredHere()` to
  // `languageToStart` in reconcileLanguage (a pseudo-language kept from a
  // development stack would stay on in a build that does not offer it).
  it("moves a kept pseudo-language back to the source where it is not offered", async () => {
    localStorage.setItem("logjam.language", "en-XA");
    const { reconcileLanguage } = await load({
      sim: false,
      device: [],
      running: "en-XA",
    });
    const reload = vi.fn();
    expect(reconcileLanguage(reload)).toBe(true);
    expect(localStorage.getItem("logjam.language")).toBe("en-AU");
    expect(reload).toHaveBeenCalledTimes(1);
  }, 30_000);
});

describe("chooseLanguage", () => {
  // Mutation: delete the `store(next)` call, or the `reload()` call, in chooseLanguage.
  it("stores an offered language and reloads", async () => {
    const { chooseLanguage } = await load({ sim: true });
    const reload = vi.fn();
    expect(chooseLanguage("en-XA", reload)).toBe(true);
    expect(localStorage.getItem("logjam.language")).toBe("en-XA");
    expect(reload).toHaveBeenCalledTimes(1);
  }, 30_000);

  // Mutation: delete `!offeredHere().includes(next) ||` in chooseLanguage.
  it("refuses a language this browser does not offer", async () => {
    const { chooseLanguage } = await load({ sim: false });
    const reload = vi.fn();
    expect(chooseLanguage("en-XA", reload)).toBe(false);
    expect(localStorage.getItem("logjam.language")).toBeNull();
    expect(reload).not.toHaveBeenCalled();
  }, 30_000);

  // Mutation: ignore `store`'s answer in chooseLanguage.
  it("says so, and does not reload, when the browser refuses the write", async () => {
    const { chooseLanguage } = await load({ sim: true });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    const reload = vi.fn();
    expect(chooseLanguage("en-US", reload)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  }, 30_000);
});

describe("useRecordLanguage", () => {
  const user = (language?: string) =>
    ({ id: "u", uiPreferences: language ? { language } : null }) as TUser;

  // Mutation: call updateUserPreferences whatever `languageToRecord` says (prod
  // would write the source language to every account on every load).
  it("writes nothing from the source language to an account with none", async () => {
    const { useRecordLanguage } = await load();
    renderHook(() => useRecordLanguage(user(), vi.fn(), true));
    expect(updateUserPreferences).not.toHaveBeenCalled();
  }, 30_000);

  // Mutation: delete `.then(applyCurrentUser)`, or send another body than `{ language: next }`.
  it("writes the running language when the account's differs, and hands back the saved user", async () => {
    const saved = user("en-US");
    updateUserPreferences.mockResolvedValue(saved);
    const apply = vi.fn();
    const { useRecordLanguage } = await load({ running: "en-US" });
    renderHook(() => useRecordLanguage(user(), apply, true));
    await waitFor(() => expect(apply).toHaveBeenCalledWith(saved));
    expect(updateUserPreferences).toHaveBeenCalledWith({ language: "en-US" });
  }, 30_000);

  // Mutation: delete `!enabled ||` in useRecordLanguage (the account would be
  // written before consent settles).
  it("writes nothing until the consent gate has settled", async () => {
    const { useRecordLanguage } = await load({ running: "en-US" });
    renderHook(() => useRecordLanguage(user(), vi.fn(), false));
    expect(updateUserPreferences).not.toHaveBeenCalled();
  }, 30_000);

  // Mutation: delete `|| !signedIn` in useRecordLanguage's guard.
  it("writes nothing while nobody is signed in", async () => {
    const { useRecordLanguage } = await load({ running: "en-US" });
    renderHook(() => useRecordLanguage(null, vi.fn(), true));
    expect(updateUserPreferences).not.toHaveBeenCalled();
  }, 30_000);

  // Mutation: delete `.catch(console.error)` (a refused write would be an unhandled rejection).
  it("logs a refused write and goes on", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    updateUserPreferences.mockRejectedValue(new Error("400"));
    const { useRecordLanguage } = await load({ running: "en-US" });
    renderHook(() => useRecordLanguage(user(), vi.fn(), true));
    await waitFor(() => expect(error).toHaveBeenCalled());
  }, 30_000);
});
