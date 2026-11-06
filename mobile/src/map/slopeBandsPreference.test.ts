import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RASTER_TEMPLATE_DEFAULTS } from "@logjam/shared";

const prefs = vi.hoisted(() => new Map<string, string>());
vi.mock("../prefsDb", () => ({
  readPref: (key: string) => prefs.get(key) ?? null,
  writePref: (key: string, value: string) => (prefs.set(key, value), true),
}));

const patch = vi.hoisted(() => vi.fn());
vi.mock("../api/apiFetch", () => ({ apiFetch: patch }));

const bands = [{ fromDeg: 30, toDeg: 90, colour: "#ff0000ff" }];
const load = () => import("./slopeBandsPreference");

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  prefs.clear();
  patch.mockReset();
  patch.mockResolvedValue({});
});
afterEach(() => vi.useRealTimers());

describe("the slope bands on Logjam GPS", () => {
  it("are the defaults until an account brings its own, then kept", async () => {
    const store = await load();
    expect(store.readSlopeBands()).toEqual(
      RASTER_TEMPLATE_DEFAULTS.slope.bands,
    );
    store.keepAccountSlopeBands(bands);
    expect(store.readSlopeBands()).toEqual(bands);
    expect(JSON.parse(prefs.get("mapSlopeBands")!)).toEqual(bands);
  });

  // Mutation: read only what the account sends, and a map opened with no
  // signal draws the default bands, not the user's.
  it("reads the kept bands at the next launch, offline", async () => {
    prefs.set("mapSlopeBands", JSON.stringify(bands));
    expect((await load()).readSlopeBands()).toEqual(bands);
  });

  it("ignores an account without bands, and a damaged copy", async () => {
    prefs.set("mapSlopeBands", "{not json");
    const store = await load();
    store.keepAccountSlopeBands(undefined);
    store.keepAccountSlopeBands([
      { fromDeg: 50, toDeg: 40, colour: "#ff0000ff" },
    ]);
    expect(store.readSlopeBands()).toEqual(
      RASTER_TEMPLATE_DEFAULTS.slope.bands,
    );
  });
});

const mine = [{ fromDeg: 20, toDeg: 90, colour: "#00ff00ff" }];
const later = [{ fromDeg: 30, toDeg: 90, colour: "#0000ffff" }];
const sent = (n: number) => patch.mock.calls[n][1].body.slopeBands;

async function signedIn(id: string | null = "alice") {
  const store = await load();
  store.setSlopeBandsAccount({ signedIn: true, id });
  return store;
}

describe("an edit made on the phone", () => {
  it("is drawn and kept at once", async () => {
    const store = await signedIn();
    store.editSlopeBands(mine);
    expect(store.readSlopeBands()).toEqual(mine);
    expect(JSON.parse(prefs.get("mapSlopeBands")!)).toEqual(mine);
  });

  it("is sent once, after the pause, and not before", async () => {
    const store = await signedIn();
    store.editSlopeBands(mine);
    store.editSlopeBands(later);
    await vi.advanceTimersByTimeAsync(799);
    expect(patch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(patch).toHaveBeenCalledTimes(1);
    expect(sent(0)).toEqual(later);
  });

  // Mutation: send nothing for a guest and the PATCH 401s on every edit; send
  // for one and a guest's phone-only setting reaches no account.
  it("is never sent for a guest", async () => {
    const store = await load();
    store.setSlopeBandsAccount({ signedIn: false, id: null });
    store.editSlopeBands(mine);
    await vi.advanceTimersByTimeAsync(5000);
    expect(patch).not.toHaveBeenCalled();
    expect(store.readSlopeBands()).toEqual(mine);
  });

  it("keeps the older account bands from undoing it until it is acknowledged", async () => {
    const store = await signedIn();
    store.editSlopeBands(mine);
    store.keepAccountSlopeBands(bands, "alice");
    expect(store.readSlopeBands()).toEqual(mine);
    await vi.advanceTimersByTimeAsync(800);
    store.keepAccountSlopeBands(bands, "alice");
    expect(store.readSlopeBands()).toEqual(bands);
  });

  // Mutation: stop recording failure and the editor never says it didn't reach.
  it("stays held, and says so, when the send fails", async () => {
    patch.mockRejectedValue(new Error("offline"));
    const store = await signedIn();
    store.editSlopeBands(mine);
    await vi.advanceTimersByTimeAsync(800);
    store.keepAccountSlopeBands(bands, "alice");
    expect(store.readSlopeBands()).toEqual(mine);
    expect(store.slopeBandsSendFailed()).toBe(true);
    // A later edit that gets through clears it.
    patch.mockResolvedValue({});
    store.editSlopeBands(later);
    await vi.advanceTimersByTimeAsync(800);
    expect(store.slopeBandsSendFailed()).toBe(false);
  });

  // Mutation: cancel the timer on unmount instead of flushing it, and an edit
  // followed by Back is never sent and the hold is never released.
  it("is sent when the editor closes inside the pause", async () => {
    const store = await signedIn();
    store.editSlopeBands(mine);
    store.flushSlopeBands();
    await vi.advanceTimersByTimeAsync(0);
    expect(patch).toHaveBeenCalledTimes(1);
    expect(sent(0)).toEqual(mine);
    store.keepAccountSlopeBands(bands, "alice");
    expect(store.readSlopeBands()).toEqual(bands);
  });

  // Mutation: release the hold on any reply, and an older reply landing last
  // lets the account's pre-edit bands back onto the map while a newer edit
  // is unsent; send in parallel and the older PATCH can win on the server.
  it("sends one at a time and is held until the latest is acknowledged", async () => {
    const replies: (() => void)[] = [];
    patch.mockImplementation(
      () => new Promise<void>((resolve) => replies.push(resolve)),
    );
    const store = await signedIn();
    store.editSlopeBands(mine);
    await vi.advanceTimersByTimeAsync(800);
    store.editSlopeBands(later);
    await vi.advanceTimersByTimeAsync(800);
    expect(patch).toHaveBeenCalledTimes(1); // the second waits for the first
    replies[0]();
    await vi.advanceTimersByTimeAsync(0);
    store.keepAccountSlopeBands(bands, "alice");
    expect(store.readSlopeBands()).toEqual(later); // still held: later unsent
    expect(patch).toHaveBeenCalledTimes(2);
    expect(sent(1)).toEqual(later);
    replies[1]();
    await vi.advanceTimersByTimeAsync(0);
    store.keepAccountSlopeBands(bands, "alice");
    expect(store.readSlopeBands()).toEqual(bands);
  });

  it("waits for the account's id when it cannot be read yet, then sends", async () => {
    const store = await signedIn(null);
    store.editSlopeBands(mine);
    // Said at once: nothing can be sent yet.
    expect(store.slopeBandsSendFailed()).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(patch).not.toHaveBeenCalled();
    store.setSlopeBandsAccount({ signedIn: true, id: "alice" });
    await vi.advanceTimersByTimeAsync(800);
    expect(sent(0)).toEqual(mine);
  });

  it("does not hold back, or send to, a different account", async () => {
    const store = await signedIn();
    store.editSlopeBands(mine);
    store.setSlopeBandsAccount({ signedIn: true, id: "bob" });
    store.keepAccountSlopeBands(bands, "bob");
    expect(store.readSlopeBands()).toEqual(bands);
    await vi.advanceTimersByTimeAsync(5000);
    expect(patch).not.toHaveBeenCalled();
  });

  // Mutation: leave the hold out of the sign-out wipe, and the same account
  // signing back in has its bands ignored until a restart.
  it("is forgotten by the sign-out wipe", async () => {
    const store = await signedIn();
    store.editSlopeBands(mine);
    store.forgetSlopeBandsEdit();
    await vi.advanceTimersByTimeAsync(5000);
    expect(patch).not.toHaveBeenCalled();
    store.keepAccountSlopeBands(bands, "alice");
    expect(store.readSlopeBands()).toEqual(bands);
  });
});
