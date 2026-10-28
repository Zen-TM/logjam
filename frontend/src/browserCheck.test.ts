import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { browserCheckPlugin } from "../vite.config";

const script = readFileSync("browser-check.js", "utf8");

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

describe("browser-check.js", () => {
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

type Hooks = {
  transformIndexHtml: { handler(html: string): string };
  generateBundle(this: {
    emitFile(f: { fileName: string; source: Buffer }): void;
  }): void;
};

// deploy-frontend.yml serves every asset `immutable`. Red if the script is
// emitted under a fixed name, or index.html points anywhere but the file
// emitted.
describe("browserCheckPlugin", () => {
  it("names the script by its content and points index.html at it", () => {
    const plugin = browserCheckPlugin() as unknown as Hooks;
    const emitted: string[] = [];
    plugin.generateBundle.call({ emitFile: (f) => emitted.push(f.fileName) });
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatch(/^assets\/browser-check-[0-9a-f]{10}\.js$/);
    expect(
      plugin.transformIndexHtml.handler('<script src="/browser-check.js">'),
    ).toBe(`<script src="/${emitted[0]}">`);
  });
});
