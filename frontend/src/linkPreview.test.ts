// @vitest-environment node
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { NSW_REGION, signInIntro } from "@logjam/shared";

const html = fs.readFileSync("index.html", "utf8");
const meta = (key: string) =>
  html.match(
    new RegExp(`<meta (?:name|property)="${key}"\\s+content="([^"]*)"`),
  )?.[1];

// What a pasted link previews as. Red if index.html's description is edited
// away from the sign-in card's sentence (`signInIntro`, for the one region prod has), which
// index.html cannot import.
describe("link preview tags in index.html", () => {
  it("describe Logjam Web in the sign-in card's own sentence", () => {
    const intro = signInIntro([NSW_REGION]);
    expect(meta("description")).toBe(intro);
    expect(meta("og:description")).toBe(intro);
  });

  it("point at an absolute https card that ships in public/", () => {
    const image = meta("og:image") ?? "";
    expect(image).toMatch(/^https:\/\//);
    expect(meta("og:url")).toMatch(/^https:\/\//);
    expect(fs.existsSync(`public/${new URL(image).pathname}`)).toBe(true);
    expect(meta("twitter:card")).toBe("summary_large_image");
  });
});
