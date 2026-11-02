import { describe, expect, it } from "vitest";
import { TOAST_MS } from "./designTokens.js";
import { loadStateOf } from "./contracts/index.js";
import { runToastAction, toastMs } from "./toast.js";

describe("toastMs", () => {
  // Mutation that turns it red: return `TOAST_MS.done` for a toast with an action.
  it("keeps an error, or a toast with an action, for the error time", () => {
    const action = { label: "Open", onPress: () => {} };
    expect(toastMs("done")).toBe(TOAST_MS.done);
    expect(toastMs("error")).toBe(TOAST_MS.error);
    expect(toastMs("done", action)).toBe(TOAST_MS.error);
  });
});

describe("runToastAction", () => {
  // Mutation that turns it red: drop the `dismiss()` call.
  it("does the action, then dismisses the toast", () => {
    const calls: string[] = [];
    runToastAction({ label: "Open", onPress: () => calls.push("press") }, () =>
      calls.push("dismiss"),
    );
    expect(calls).toEqual(["press", "dismiss"]);
  });
});

describe("loadStateOf", () => {
  // Mutation that turns it red: return "ready" whenever there is an error
  // (what `usePlaces` did by setting `loaded` after a failure).
  it("is failed, not ready, when the first load errored", () => {
    expect(loadStateOf(false, "Couldn't load places.")).toBe("failed");
    expect(loadStateOf(false, null)).toBe("loading");
    expect(loadStateOf(true, null)).toBe("ready");
    // A refetch that fails under a list already shown leaves the list up.
    expect(loadStateOf(true, "Couldn't load places.")).toBe("ready");
  });
});
