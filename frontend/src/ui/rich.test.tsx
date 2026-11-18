import { cleanup, render } from "@testing-library/react";
import { rich } from "@logjam/shared";
import { afterEach, describe, expect, it } from "vitest";
import { Rich } from "./rich";

afterEach(cleanup);

describe("Rich", () => {
  // Mutation: render a tag's `text` without calling `tags[part.tag]`, so the
  // address loses its element.
  it("draws a tag as the element its caller gives it, and the rest as text", () => {
    const { container } = render(
      <p>
        <Rich
          parts={rich`A code went to <b>${"a@b.c"}</b>. Check the spam folder.`}
          tags={{ b: (text) => <b>{text}</b> }}
        />
      </p>,
    );
    expect(container.innerHTML).toBe(
      "<p>A code went to <b>a@b.c</b>. Check the spam folder.</p>",
    );
  });

  // Mutation: return `null` for a tag `tags` does not name, instead of its
  // text, and the words go missing.
  it("keeps the words of a tag the caller does not name", () => {
    const { container } = render(
      <Rich parts={rich`Open <a>${"the map"}</a>.`} tags={{}} />,
    );
    expect(container.textContent).toBe("Open the map.");
  });
});
