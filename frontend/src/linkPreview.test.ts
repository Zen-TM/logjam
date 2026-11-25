// @vitest-environment node
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { SIGN_IN_COPY } from "@logjam/shared";

const html = fs.readFileSync("index.html", "utf8");
const meta = (key: string) =>
  html.match(
    new RegExp(`<meta (?:name|property)="${key}"\\s+content="([^"]*)"`),
  )?.[1];

// What a pasted link previews as. Red if index.html's description is edited
// away from the sign-in card's sentence (`SIGN_IN_COPY.intro`), which
// index.html cannot import.
describe("link preview tags in index.html", () => {
  it("describe Logjam Web in the sign-in card's own sentence", () => {
    expect(meta("description")).toBe(SIGN_IN_COPY.intro);
    expect(meta("og:description")).toBe(SIGN_IN_COPY.intro);
  });

  it("point at an absolute https card that ships in public/", () => {
    const image = meta("og:image") ?? "";
    expect(image).toMatch(/^https:\/\//);
    expect(meta("og:url")).toMatch(/^https:\/\//);
    expect(fs.existsSync(`public/${new URL(image).pathname}`)).toBe(true);
    expect(meta("twitter:card")).toBe("summary_large_image");
  });
});
