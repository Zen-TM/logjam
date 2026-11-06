import { describe, expect, it, vi } from "vitest";

// What `Animated.forkEvent` does with the native event the hero collapse hands
// a list as `onScroll` (react-native's AnimatedImplementation.js): a native
// event is an object, not a function, and takes the listener in place.
class FakeAnimatedEvent {
  listeners: ((...args: unknown[]) => void)[] = [];
}
vi.mock("react-native", () => ({
  RefreshControl: class {},
  Animated: {
    forkEvent: (event: FakeAnimatedEvent, listener: () => void) => {
      event.listeners.push(listener);
      return event;
    },
  },
}));

const { mergeScrollProps } = await import("./refreshFromTop");

describe("mergeScrollProps", () => {
  // Red when an object-valued `onScroll` is dropped for the second set's
  // function (`{ ...a, ...b }`): the hero stops following the finger.
  it("keeps the hero's native scroll event and feeds the pin from it", () => {
    const event = new FakeAnimatedEvent();
    const seen: number[] = [];
    const merged = mergeScrollProps(
      { onScroll: event },
      { onScroll: (y: number) => seen.push(y) },
    );
    expect(merged.onScroll).toBe(event);
    for (const listener of event.listeners) listener(40);
    expect(seen).toEqual([40]);
  });

  // Red when the fork is repeated on every merge: a screen merges on each
  // render and the pin would be told of every scroll once per render.
  it("forks once however often it is merged", () => {
    const event = new FakeAnimatedEvent();
    const onScroll = () => undefined;
    for (let render = 0; render < 3; render++)
      mergeScrollProps({ onScroll: event }, { onScroll });
    expect(event.listeners).toHaveLength(1);
  });

  // Red when a handler named by both sets runs for only one of them: a drag
  // would collapse the hero or pin the refresh, not both.
  it("runs both sets' function handlers, in order", () => {
    const calls: string[] = [];
    const merged = mergeScrollProps(
      { onScrollBeginDrag: () => calls.push("hero"), ref: "r" },
      { onScrollBeginDrag: () => calls.push("pin"), onTouchStart: () => 1 },
    );
    merged.onScrollBeginDrag();
    expect(calls).toEqual(["hero", "pin"]);
    expect(merged.ref).toBe("r");
    expect(typeof merged.onTouchStart).toBe("function");
  });
});
