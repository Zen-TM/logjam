import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ColourScale } from "./ColourScale";

afterEach(cleanup);

describe("ColourScale", () => {
  // Mutation: reverse the gradient or drop a stop, and the strip's colours no
  // longer sit over their numbers; drop aria-hidden, and a screen reader reads
  // a run of bare numbers.
  it("draws the stops in order over their numbers, hidden from a screen reader", () => {
    const { container } = render(
      <ColourScale
        stops={[
          { label: "1", colour: "#ff0000" },
          { label: "2", colour: "#00ff00" },
          { label: "3", colour: "#0000ff" },
        ]}
      />,
    );
    const scale = container.firstElementChild as HTMLElement;
    expect(scale.getAttribute("aria-hidden")).toBe("true");
    expect(scale.textContent).toBe("123");
    const strip = scale.firstElementChild as HTMLElement;
    expect(strip.style.getPropertyValue("--scale-stops")).toBe(
      "#ff0000, #00ff00, #0000ff",
    );
  });
});
