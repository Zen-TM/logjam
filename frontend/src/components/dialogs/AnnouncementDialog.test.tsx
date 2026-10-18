import { cleanup, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ANNOUNCEMENT } from "@logjam/shared";
import AnnouncementDialog from "./AnnouncementDialog";

// jsdom has no modal <dialog>; the kit's Dialog calls both.
HTMLDialogElement.prototype.showModal = function showModal() {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close = function close() {
  this.removeAttribute("open");
};

afterEach(cleanup);

const open = (body: string) =>
  render(
    <AnnouncementDialog
      message={{ title: "Track sharing is here", body }}
      onClose={() => {}}
    />,
  ).baseElement.querySelector("dialog")!;

describe("AnnouncementDialog", () => {
  // Mutation: drop a case from `block` or `inlines` (that kind then draws
  // nothing), or the `.from` line.
  it("draws every block and inline kind as its own element", () => {
    const dialog = open(
      [
        "# Big",
        "## Middle",
        "### Small",
        "Some **bold**, *slanted* and `code`  ",
        "after a break, [a link](https://example.com).",
        "",
        "- one",
        "- two",
        "",
        "3. three",
        "4. four",
      ].join("\n"),
    );
    const view = within(dialog);
    expect(view.getByRole("heading", { level: 2 }).textContent).toBe(
      "Track sharing is here",
    );
    expect(view.getByText(ANNOUNCEMENT.from)).toBeTruthy();
    expect(view.getByRole("heading", { level: 3 }).textContent).toBe("Big");
    expect(view.getByRole("heading", { level: 4 }).textContent).toBe("Middle");
    expect(view.getByRole("heading", { level: 5 }).textContent).toBe("Small");
    expect(dialog.querySelector("strong")?.textContent).toBe("bold");
    expect(dialog.querySelector("em")?.textContent).toBe("slanted");
    expect(dialog.querySelector("code")?.textContent).toBe("code");
    expect(dialog.querySelector("br")).toBeTruthy();
    expect(view.getByRole("link").textContent).toBe("a link");
    expect(dialog.querySelectorAll("ul > li")).toHaveLength(2);
    expect(dialog.querySelector("ol")?.getAttribute("start")).toBe("3");
    expect(dialog.querySelectorAll("ol > li")).toHaveLength(2);
  });

  // Mutation: drop `target` or `rel` from the link.
  it("opens a link in a new tab without handing it this page", () => {
    const link = within(
      open("[Read more](https://example.com/news)"),
    ).getByRole("link", { name: "Read more" });
    expect(link.getAttribute("href")).toBe("https://example.com/news");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  // Mutation: draw a text node through `dangerouslySetInnerHTML`.
  it("draws HTML in the body as text, never as markup", () => {
    const dialog = open(
      'Hi <script>alert(1)</script> <img src="x" onerror="alert(2)"> [x](javascript:alert(3))',
    );
    expect(dialog.querySelector("script, img")).toBeNull();
    expect(dialog.querySelector("a")).toBeNull();
    expect(dialog.textContent).toContain("<script>alert(1)</script>");
  });
});
