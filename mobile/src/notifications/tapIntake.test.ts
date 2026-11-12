import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createTapIntake } from "./tapIntake";

function setup(ready: boolean) {
  const state = { ready };
  const went: string[] = [];
  const intake = createTapIntake<string>(
    () => state.ready,
    (tap) => went.push(tap),
  );
  return { state, went, intake };
}

describe("createTapIntake", () => {
  // Mutation: go() without checking isReady, and a cold-start tap navigates
  // into a navigator that does not exist yet and is dropped.
  it("holds a cold-start tap until the navigator is ready", () => {
    const { state, went, intake } = setup(false);
    intake.offer("n1", "a");
    expect(went).toEqual([]);
    intake.flush();
    expect(went).toEqual([]);
    state.ready = true;
    intake.flush();
    expect(went).toEqual(["a"]);
  });

  it("goes straight away when the navigator is ready (warm and foreground)", () => {
    const { went, intake } = setup(true);
    intake.offer("n1", "a");
    expect(went).toEqual(["a"]);
  });

  // Mutation: drop the `seen` set, and the cold-start slot read on each shell
  // mount re-navigates to a tap already followed.
  it("takes a tap once, however often it is offered", () => {
    const { went, intake } = setup(true);
    intake.offer("n1", "a");
    intake.offer("n1", "a");
    intake.offer("n2", "b");
    expect(went).toEqual(["a", "b"]);
  });

  it("releases a held tap once, not on every flush", () => {
    const { state, went, intake } = setup(false);
    intake.offer("n1", "a");
    state.ready = true;
    intake.flush();
    intake.flush();
    expect(went).toEqual(["a"]);
  });

  it("keeps only the newest of taps held together", () => {
    const { state, went, intake } = setup(false);
    intake.offer("n1", "a");
    intake.offer("n2", "b");
    state.ready = true;
    intake.flush();
    expect(went).toEqual(["b"]);
  });
});

describe("createTapIntake.clear", () => {
  // Mutation: make clear() a no-op, and a tap held behind the consent gate
  // fires in the next account's navigator after a sign-out.
  it("drops a held tap, so a sign-out does not hand it to the next account", () => {
    const { state, went, intake } = setup(false);
    intake.offer("n1", "a");
    intake.clear();
    state.ready = true;
    intake.flush();
    expect(went).toEqual([]);
  });
});

// AppShell and App cannot be loaded here (React Native's sources), so the wiring
// the cold start depends on is held as text, as `ui/toastHost.test.ts` does.
describe("the shell feeds the intake", () => {
  const read = (...path: string[]) =>
    readFileSync(join(__dirname, "..", "..", ...path), "utf8");

  // Mutation: drop `onReady={tapIntake.flush}`, and every cold-start tap is held
  // forever, because the navigator is not ready when the shell's effect runs.
  it("releases a held tap when the navigator is ready", () => {
    expect(read("src", "AppShell.tsx")).toContain("onReady={tapIntake.flush}");
  });

  // Mutation: drop the last-response read, and the tap that STARTED the app is
  // never seen (a listener added afterwards is not given it); drop the clear
  // beside it and a JS reload re-follows it.
  it("reads, then clears, the tap that launched the app", () => {
    const shell = read("src", "AppShell.tsx");
    expect(shell).toContain("Notifications.getLastNotificationResponse()");
    expect(shell).toMatch(
      /offerTap\(launching\);[\s\S]{0,200}Notifications\.clearLastNotificationResponse\(\)/,
    );
  });

  // Mutation: drop the sign-out wiring, and a tap held for one account opens
  // for the next one who signs in on this phone.
  it("drops a held tap on sign-out", () => {
    expect(read("App.tsx")).toContain(
      "dropNotificationTap: dropPendingNotificationTap",
    );
    expect(read("src", "AppShell.tsx")).toMatch(
      /dropPendingNotificationTap\(\) \{\s*tapIntake\.clear\(\);\s*Notifications\.clearLastNotificationResponse\(\);/,
    );
  });

  // Mutation: drop either read, and the "Recording track" / map-download
  // notification goes back to resuming the app where it was left (the launch
  // read) or does nothing while Logjam GPS is open (the event).
  it("feeds the ongoing notifications' URLs in, at launch and while open", () => {
    const shell = read("src", "AppShell.tsx");
    expect(shell).toContain('Linking.addEventListener("url"');
    expect(shell).toMatch(
      /Linking\.getInitialURL\(\)[\s\S]{0,120}offerOngoingUrl\(url, id\)/,
    );
  });

  // Mutation: go back to a process-wide flag or a constant launch id, and a tap
  // on "Recording track" after a swipe from Recents (new activity, JS runtime
  // still alive) is dropped as already read, and the app opens wherever.
  it("reads the launching URL once per shell mount, not once per process", () => {
    const shell = read("src", "AppShell.tsx");
    expect(shell).toContain("`ongoing-launch-${launchMounts++}`");
    expect(shell).not.toMatch(/launchUrlRead|"ongoing-launch"/);
  });
});
