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
