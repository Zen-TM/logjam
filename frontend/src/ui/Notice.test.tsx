import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { Notice } from "./MapControl";

afterEach(cleanup);

describe("Notice", () => {
  // Mutation: drop `"critical"` from the `role` check, and a notice about data
  // being lost is announced to no one.
  it("announces a critical notice as an alert", () => {
    render(
      <Notice tone="critical" icon="warning">
        Points aren&apos;t being saved
      </Notice>,
    );
    const alert = screen.getByRole("alert");
    expect(alert.getAttribute("data-tone")).toBe("critical");
  });

  it("leaves an info notice as plain text", () => {
    render(<Notice>Showing 3 of 9 places</Notice>);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  // Mutation: change the critical `background` to `var(--color-page)`, and the
  // loudest notice looks like the quietest.
  it("fills a critical notice with the warning fill and onFill words", () => {
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "MapControl.module.css"),
      "utf8",
    );
    const rule = css.match(/\.notice\[data-tone="critical"\] \{([^}]*)\}/)?.[1];
    expect(rule).toContain("background: var(--color-warning)");
    expect(rule).toContain("color: var(--color-on-fill)");
  });
});
