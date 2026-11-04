import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import WriteUpBody, { NoteBody } from "./WriteUpBody";

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

describe("a place's or trip's notes", () => {
  // Mutation: draw `noteBlocks` without `breaks`, and a plain note's lines
  // run together.
  it("keeps the lines of a plain note", () => {
    const { container } = render(<NoteBody notes={"Rope 2 x 60 m\nWetsuit"} />);
    expect(container.querySelectorAll("br")).toHaveLength(1);
    expect(container.textContent).toBe("Rope 2 x 60 mWetsuit");
  });

  // Mutation: let `messageInlines` or the shared parser pass an html, image
  // or unsafe-link node through; a sharee would run it.
  it("never draws markup, an image or a script link from a note", () => {
    const { container } = render(
      <NoteBody
        notes={
          'Hi <img src=x onerror="alert(1)"> ![p](https://x.test/a.png) [go](javascript:alert(1)) <script>x</script>\n\n[ok](https://example.com)'
        }
      />,
    );
    expect(container.querySelector("img, script")).toBeNull();
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("link").getAttribute("href")).toBe(
      "https://example.com",
    );
    expect(container.textContent).toContain("<script>x</script>");
  });

  it("draws bold, italic and a list", () => {
    const { container } = render(<NoteBody notes={"**Beta**\n\n- *a*\n- b"} />);
    expect(container.querySelector("strong")?.textContent).toBe("Beta");
    expect(container.querySelector("li > em")?.textContent).toBe("a");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
});
