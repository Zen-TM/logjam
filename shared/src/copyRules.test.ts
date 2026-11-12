import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import {
  ApiError,
  AUTH_ERROR_CODES,
  messageFromError,
  SIGNUP_CAP_MESSAGE,
} from "./apiErrors.js";
import * as contracts from "./contracts/index.js";
import { copySay, copyViolations } from "./copyRules.js";
import { NSW_REGION } from "./regions.js";

// Every string a screen contract declares keeps the copy rules of
// shared/DESIGN.md §12: no "Retry", no "the app", no "basemap", "tiles" or "the
// server", no Title Case label. A hit is fixed; the clients' own scans
// (`copyRules.test.ts` in each) take an allow-list with a reason.
//
// Mutation that turns it red: set `tabBasemap` in `contracts/mapLayers.ts`
// back to "Basemap".

/** Keys that hold an identifier or a note for developers, not words a user reads. */
const NOT_COPY = new Set([
  "id",
  "key",
  "reason",
  "gap",
  "on",
  "question",
  "icon",
]);

function strings(value: unknown, path: string, out: [string, string][]): void {
  if (typeof value === "string") out.push([path, value]);
  else if (Array.isArray(value))
    value.forEach((item, index) => strings(item, `${path}[${index}]`, out));
  else if (value && typeof value === "object")
    for (const [key, item] of Object.entries(value))
      if (!NOT_COPY.has(key)) strings(item, `${path}.${key}`, out);
}

/** Every string a contract's functions return for a count or a name. */
function fromFunctions(out: [string, string][]): void {
  for (const [name, value] of Object.entries(contracts)) {
    if (typeof value !== "function") continue;
    for (const arg of [0, 1, 3, "Ranon"]) {
      try {
        const result = (value as (a: unknown) => unknown)(arg);
        if (typeof result === "string") out.push([`${name}(${arg})`, result]);
      } catch {
        // Not a function of one count or one name.
      }
    }
  }
}

describe("contract copy", () => {
  const all: [string, string][] = [];
  for (const [name, value] of Object.entries(contracts)) {
    if (typeof value !== "function") strings(value, name, all);
  }
  fromFunctions(all);
  // Functions of a region, which `fromFunctions` can't call. Mutation: put
  // "Retry" in `ROPEWIKI_OFFER.confirmBody`.
  const { ROPEWIKI_OFFER } = contracts;
  for (const key of ["title", "hint", "confirmBody"] as const)
    all.push([`ROPEWIKI_OFFER.${key}`, ROPEWIKI_OFFER[key](NSW_REGION)]);
  for (const offers of [1, 2])
    all.push([
      `ROPEWIKI_OFFER.menu(${offers})`,
      ROPEWIKI_OFFER.menu(NSW_REGION, offers),
    ]);

  it("reads strings at all — a silent zero would pass forever", () => {
    expect(all.length).toBeGreaterThan(500);
  });

  it("recognises what it forbids", () => {
    expect(copyViolations("Retry")).toEqual(["retry"]);
    expect(copyViolations("Use the app")).toEqual(["the-app"]);
    expect(copyViolations("Mark All Read")).toEqual(["title-case"]);
    expect(copyViolations("Mark all as read")).toEqual([]);
    expect(copyViolations("Logjam GPS")).toEqual([]);
    expect(copyViolations("Finished GeoPDFs")).toEqual([]);
  });

  // One line a rule must flag and one it must leave alone, per rule of the
  // glossary and the error register. Mutation: loosen any pattern to `/./`,
  // or narrow it to nothing.
  it.each([
    ["please", "Please try again.", "Couldn't save this place."],
    ["cannot", "We cannot do that.", "We can't do that."],
    ["that-didnt-work", "That didn't work.", "Couldn't save this place."],
    ["curly-apostrophe", "Couldn’t save.", "Couldn't save."],
    ["curly-apostrophe", "Couldn&rsquo;t save.", "Couldn't save."],
    ["waypoint", "Add a waypoint", "Add a place"],
    ["custom-field", "Edit custom fields", "Edit attributes"],
    ["logbook", "Your logbook", "Your trips"],
    ["trip-log", "Start a trip log", "Log a trip"],
    ["logs-tab", "Back to Logs", "Back to Trips"],
    ["activity", "By activity", "By trip type"],
    ["lidar-topo", "Make a LiDAR topo", "Make a sharpened area"],
    ["lidar-topo", "Open the topo", "Open the sharpened area"],
    ["lidar-topo", "Use a topo", "OSM Topo"],
    ["region", "Download a map region", "Save an offline map"],
    ["region", "Region 3", "Offline map 3"],
    ["region", "Delete saved regions", "Where do you canyon? Regions"],
    ["offline-map", "Save maps offline", "Save an offline map"],
    ["offline-map", "Download the map for this area", "Save an offline map"],
    ["offline-map", "Map downloaded", "Offline map saved"],
    ["offline-map", "Save map", "Save an offline map"],
    ["unshare", "Unshare", "Stop sharing"],
    ["recipients", "Visible to recipients", "Friends you pick can see it"],
    ["turn-down", "Turn down", "Decline"],
    ["turn-down", "Let in", "Accept"],
    [
      "turn-down",
      "Waiting for mira to let you in",
      "Waiting for mira to accept you",
    ],
    ["attach-to-place", "Attach to a place", "Link to a place"],
    // Mutation: drop any one alternative of export-is-a-file and its row
    // stops flagging.
    ["export-is-a-file", "Export an area", "Make a map"],
    ["export-is-a-file", "Export this area", "Make a map here"],
    ["export-is-a-file", "Area exports", "Print and GIS maps"],
    ["export-is-a-file", "Your export is ready", "Your map is ready"],
    ["export-is-a-file", "You have 3 exports already", "You have 3 map files"],
    ["export-is-a-file", "Exports are kept for 7 days", "Map files are kept"],
    [
      "export-is-a-file",
      "You can run 2 exports at a time",
      "You can make 2 maps",
    ],
    [
      "export-is-a-file",
      "Split it into smaller exports",
      "Split it into smaller maps",
    ],
  ])("flags %s in %j and passes %j", (id, bad, good) => {
    expect(copyViolations(bad)).toContain(id);
    expect(copyViolations(good)).not.toContain(id);
  });

  // A file is exported: "an export of" and "an export as" name one.
  // Mutation: delete the `(?! (?:of|as)\b)` lookahead of export-is-a-file.
  it("lets an export of a file through", () => {
    for (const text of [
      "Download an export of your data",
      "Your export as GPX is ready",
    ])
      expect(copyViolations(text)).not.toContain("export-is-a-file");
  });

  // One word, then a name: the name's own capital makes it read as Title
  // Case ("Join Ranon"). Mutation: empty this set, and the title is flagged.
  const verbThenName = new Set(["tripPlanJoinTitle(Ranon)"]);

  // Mutation: widen the offline-map or turn-down pattern back to a bare
  // "download the map" / "let you in", and one of these goes red.
  it.each([
    "Download the map as a PDF",
    "Save map style",
    "This lets you invite a friend",
    "It lets you install it",
  ])("leaves %j alone", (text) => {
    expect(copyViolations(text)).not.toContain("offline-map");
    expect(copyViolations(text)).not.toContain("turn-down");
  });

  it.each([
    "Save maps",
    "Save offline maps",
    "Download maps",
    "Save maps for offline use",
    "Download the map of this area",
  ])("flags %j", (text) => {
    expect(copyViolations(text)).toContain("offline-map");
  });

  it("breaks no copy rule", () => {
    const offenders = all
      .filter(([path]) => !verbThenName.has(path))
      .flatMap(([path, text]) =>
        copyViolations(text).map((id) => `${path}: "${text}" — ${copySay(id)}`),
      );
    expect(offenders).toEqual([]);
  }, 30_000);
});

describe("the words an API failure shows", () => {
  it("break no copy rule", () => {
    const messages = [400, 401, 403, 404, 409, 429, 500, 502, 503].map((s) =>
      messageFromError(new ApiError(s, "/x", "GET"), "Couldn't do that."),
    );
    messages.push(
      messageFromError(new TypeError("Failed to fetch"), "fallback"),
      messageFromError(new Error("Network Error"), "fallback"),
    );
    expect(messages.flatMap(copyViolations)).toEqual([]);
  });
});

// The sentences in shared/src outside contracts/ (labels, notification text,
// validation and error sentences) keep the same rules as the contracts and the
// clients: a hit is fixed here, with no baseline. Mutation that turns it red: put "Please"
// back into `STATUS_MESSAGES[401]` in `apiErrors.ts`.
describe("shared copy outside contracts/", () => {
  const SRC = dirname(fileURLToPath(import.meta.url));
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory())
        return entry.name === "contracts" ? [] : files(path);
      return /\.tsx?$/.test(entry.name) && !/\.(test|d)\./.test(entry.name)
        ? [path]
        : [];
    });
  const scanned = files(SRC);

  it("reads files at all — a silent zero would pass forever", () => {
    expect(scanned.length).toBeGreaterThan(40);
  });

  // Every string literal and template with a space in it: a sentence, not an
  // identifier, key or URL, wherever it is written (a returned template, a
  // record, a `failure:` property). Left out: the message of a thrown `Error`
  // (never shown, §11), Title Case (names in data: canyons, schemes, land
  // classes), and the two files that quote a provider's own product names and
  // required credits, which we cannot reword.
  const PROVIDER_TEXT = new Set(["geoPdfBaseLayers.ts", "demSources.ts"]);
  const sentences = (path: string): { line: number; text: string }[] => {
    const sf = ts.createSourceFile(
      path,
      readFileSync(path, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const found: { line: number; text: string }[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
      if (ts.isNewExpression(node) && node.expression.getText() === "Error")
        return;
      let text: string | null = null;
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
        text = node.text;
      else if (ts.isTemplateExpression(node))
        text =
          node.head.text +
          node.templateSpans.map((span) => span.literal.text).join("");
      if (text && /\s/.test(text.trim()) && !/^https?:/.test(text))
        found.push({
          line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          text,
        });
      ts.forEachChild(node, visit);
    };
    visit(sf);
    return found;
  };

  it("breaks no copy rule", () => {
    const offenders = scanned
      .filter(
        (path) =>
          relative(SRC, path) !== "copyRules.ts" &&
          !PROVIDER_TEXT.has(relative(SRC, path)),
      )
      .flatMap((path) =>
        sentences(path).flatMap((found) =>
          copyViolations(found.text)
            .filter((id) => id !== "title-case")
            .map(
              (id) =>
                `${relative(SRC, path)}:${found.line}: "${found.text}" — ${copySay(id)}`,
            ),
        ),
      );
    expect(offenders).toEqual([]);
  });

  it("keeps every sign-in and failure message to the register", () => {
    const messages = [
      ...Object.values(AUTH_ERROR_CODES),
      SIGNUP_CAP_MESSAGE,
      ...Array.from({ length: 200 }, (_, i) =>
        messageFromError(
          new ApiError(400 + i, "/x", "GET"),
          "Couldn't do that.",
        ),
      ),
      messageFromError(new TypeError("Failed to fetch"), "fallback"),
    ];
    expect(messages.flatMap(copyViolations)).toEqual([]);
  });
});

// The words a person reads that no JSX or contract holds: the static pages
// (`frontend/public/*.html`, the privacy policy and the terms the consent
// screen links to) and the strings of `mobile/app.json`, which the operating
// system shows in its permission prompts. A legal text keeps its own
// vocabulary ("tiles", "cannot", "logs"), so the pages are held only to the
// rule that needs no legal reading: name the surface, never "the app". The
// prompts are held to every rule. A hit is fixed, or listed with the reason.
//
// Mutation that turns it red: put "in the app" back into `savePhotosPermission`
// in `mobile/app.json`, or write "the app" into `frontend/public/tos.html`.
describe("static pages and permission prompts", () => {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const ALLOWED_PAGE_TEXT: { file: string; text: string; reason: string }[] = [
    {
      file: "frontend/public/privacy.html",
      text: "recent app activity leading up to it",
      reason: "privacy policy wording is the maintainer's to change",
    },
    {
      file: "frontend/public/privacy.html",
      text: "only while the layer is on and the app is open",
      reason: "privacy policy wording is the maintainer's to change",
    },
  ];

  const pages = readdirSync(join(ROOT, "frontend/public"))
    .filter((name) => name.endsWith(".html"))
    .map((name) => `frontend/public/${name}`);
  const visibleSentences = (file: string): string[] =>
    readFileSync(join(ROOT, file), "utf8")
      .replace(/<(script|style)[\s\S]*?<\/\1>/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .split(/(?<=[.!?])\s+/);

  const prompts: [string, string][] = [];
  const walk = (value: unknown, path: string): void => {
    if (typeof value === "string") {
      if (/\s/.test(value)) prompts.push([path, value]);
    } else if (Array.isArray(value))
      value.forEach((item, index) => walk(item, `${path}[${index}]`));
    else if (value && typeof value === "object")
      for (const [key, item] of Object.entries(value))
        walk(item, `${path}.${key}`);
  };
  walk(
    JSON.parse(readFileSync(join(ROOT, "mobile/app.json"), "utf8")),
    "app.json",
  );

  it("reads the pages and prompts at all, so a silent zero cannot pass", () => {
    expect(pages.length).toBeGreaterThanOrEqual(2);
    expect(pages.flatMap(visibleSentences).length).toBeGreaterThan(100);
    expect(prompts.length).toBeGreaterThanOrEqual(3);
  });

  it("names Logjam Web or Logjam GPS on every page, never the app", () => {
    const offenders = pages.flatMap((file) =>
      visibleSentences(file)
        .filter((text) => copyViolations(text).includes("the-app"))
        .filter(
          (text) =>
            !ALLOWED_PAGE_TEXT.some(
              (a) => a.file === file && text.includes(a.text),
            ),
        )
        .map((text) => `${file}: "${text}" — ${copySay("the-app")}`),
    );
    expect(offenders).toEqual([]);
  });

  it("allows only page text that is still on its page", () => {
    for (const { file, text } of ALLOWED_PAGE_TEXT)
      expect(visibleSentences(file).some((s) => s.includes(text))).toBe(true);
  });

  it("keeps every permission prompt to the copy rules", () => {
    const offenders = prompts.flatMap(([path, text]) =>
      copyViolations(text).map((id) => `${path}: "${text}" — ${copySay(id)}`),
    );
    expect(offenders).toEqual([]);
  });
});
