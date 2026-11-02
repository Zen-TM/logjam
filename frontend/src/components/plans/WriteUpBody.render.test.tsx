import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import WriteUpBody from "./WriteUpBody";

afterEach(cleanup);

describe("a write-up section's text", () => {
  // Mutation: render a body heading as <h1>-<h6> again, and it rivals the
  // section's title.
  it("draws a heading in the body as a bold line, and drops the repeated title", () => {
    const { container } = render(
      <WriteUpBody
        title="Gear"
        body={"# Gear\n\n## Ropes\n\n- 2 x 60 m\n\n[map](https://example.com)"}
      />,
    );
    expect(screen.queryByRole("heading")).toBeNull();
    expect(container.querySelector("p > strong")?.textContent).toBe("Ropes");
    expect(container.textContent).not.toMatch(/Gear/);
    expect(screen.getByRole("listitem").textContent).toBe("2 x 60 m");
    expect(
      screen.getByRole("link", { name: "map" }).getAttribute("target"),
    ).toBe("_blank");
  });
});
