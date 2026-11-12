import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RangePills } from "./RangePills";

// jsdom has no pointer capture.
HTMLElement.prototype.hasPointerCapture = () => false;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function pills(onChange: (next: unknown) => void) {
  render(
    <RangePills
      label="Grade"
      stops={[1, 2, 3, 4, 5]}
      value={null}
      onChange={onChange}
    />,
  );
  return (n: number) => screen.getByRole("button", { name: String(n) });
}

describe("RangePills", () => {
  // Mutation: drop the `justDragged` check from a pill's onClick, or never
  // reset it.
  it("lets a drag's own click through without toggling, and only that one", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const pill = pills(onChange);

    fireEvent.pointerDown(pill(2), { button: 0, pointerId: 1 });
    fireEvent.pointerEnter(pill(4));
    fireEvent.pointerUp(window);
    fireEvent.click(pill(4));
    expect(onChange.mock.calls).toEqual([[[2, 4]]]);

    act(() => vi.runAllTimers());
    fireEvent.click(pill(5));
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});
