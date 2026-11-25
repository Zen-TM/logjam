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

  // Mutation: set `.fixedWidth` to `min-width`, or drop `--notice-card-width`
  // from index.css, and the weather card breathes with its words again.
  it("pins a fixed-width notice to one width the page defines", () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const css = readFileSync(join(dir, "MapControl.module.css"), "utf8");
    expect(css.match(/\.fixedWidth \{([^}]*)\}/)?.[1]).toContain(
      "width: var(--notice-card-width)",
    );
    expect(readFileSync(join(dir, "../index.css"), "utf8")).toMatch(
      /--notice-card-width: [\d.]+rem;/,
    );
    render(<Notice fixedWidth>Words</Notice>);
    expect(document.querySelector("[data-tone]")!.className).toMatch(
      /fixedWidth/,
    );
  });

  // Mutation: make the words a `span` whatever `onText` says.
  it("makes the words a button when it has somewhere to go", () => {
    let pressed = 0;
    render(
      <Notice onText={() => pressed++} textHint="Choose">
        Rain
      </Notice>,
    );
    screen.getByRole("button", { name: "Rain" }).click();
    expect(pressed).toBe(1);
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

  // Mutation: drop the `:hover`/`:active` rule, and the words answer no press;
  // drop `min-height`, and a single line is a 21 px target.
  it("answers the press on the words, and is a control high", () => {
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "MapControl.module.css"),
      "utf8",
    );
    expect(css).toMatch(
      /\.textButton:hover,\s*\.textButton:active \{[^}]*opacity: var\(--opacity-pressed\)/,
    );
    expect(css.match(/\.textButton \{([^}]*)\}/)?.[1]).toContain(
      "min-height: var(--control-sm)",
    );
  });

  // Mutation: drop the `twoLines` branch from the button, and a title the user
  // typed runs to any length in the words that open Layers.
  it("clamps the words of a button to two lines too", () => {
    render(
      <Notice onText={() => {}} twoLines>
        A long name
      </Notice>,
    );
    const words = screen.getByRole("button").firstElementChild!;
    expect(words.className).toMatch(/twoLines/);
    expect(words.textContent).toBe("A long name");
  });
});
