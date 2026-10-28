import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const script = readFileSync("public/browser-check.js", "utf8");

function run(hasPopover: boolean) {
  document.body.innerHTML = '<div id="root"></div>';
  if (hasPopover)
    Object.defineProperty(HTMLElement.prototype, "popover", {
      value: null,
      configurable: true,
    });
  else
    delete (HTMLElement.prototype as unknown as Record<string, unknown>)
      .popover;
  window.matchMedia = (() => ({
    matches: false,
  })) as unknown as typeof window.matchMedia;
  new Function(script)();
}

describe("public/browser-check.js", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });
  afterEach(() => {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>)
      .popover;
  });

  // Red if the check is removed, or tests the user agent instead of the API.
  it("replaces #root with the newer-browser page when the Popover API is missing", () => {
    run(false);
    expect(document.getElementById("root")).toBeNull();
    expect(document.body.textContent).toContain(
      "Logjam Web needs Safari 17, Chrome 114 or Firefox 125",
    );
  });

  // Red if the check inverts or always fires.
  it("leaves #root alone when the Popover API exists", () => {
    run(true);
    expect(document.getElementById("root")).not.toBeNull();
    expect(document.querySelector("[data-unsupported-browser]")).toBeNull();
  });
});
