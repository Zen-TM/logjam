import { readFileSync, writeFileSync } from "node:fs";
import {
  test,
  expect,
  type Page,
  type Request,
  type TestInfo,
} from "@playwright/test";
import { pseudo } from "@logjam/shared";
import { stubMaster } from "./__fixtures__/stubMaster";
import { statewideArchives } from "./__fixtures__/geoPdfTiles";
import { SEED_NAMES } from "../../api/prisma/seedNames";

// Logjam Web in the pseudo-language (the `pseudo` project, playwright.config.ts):
// every message that goes through the catalogue reads ⟦áççéñtéd~~~⟧, so text
// on screen without the brackets skipped it, and a label that only just fitted
// in English now spills. The reasoning is
// docs/decisions/0050-user-facing-text-goes-through-one-catalogue-function.md.
//
// Local only, like a11y.spec.ts: it needs fake auth and the seeded API.
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:5173";
test.skip(
  !baseURL.startsWith("http://localhost"),
  "needs the local fake-auth stack",
);
// As frontend/src/placeUtils.ts reads it.
const API_URL = process.env.VITE_API_URL ?? "http://localhost:8080";

/**
 * Text the walk may find outside ⟦ ⟧: what it found when the list was last
 * written. Seeded names are `{}` and every number is `0` in it, so it does not
 * change with the seed's rows or the day of the run.
 */
const LIST = new URL("./pseudo-unwrapped.json", import.meta.url);
const WRITE_LIST = !!process.env.PSEUDO_WRITE_LIST;
const REWRITE =
  "PSEUDO_WRITE_LIST=1 npx playwright test --project=pseudo (in frontend/, the stack up)";

/** Distinct messages the walk must meet in ⟦ ⟧: a walk that never left English meets none, and the list may be rewritten from it. */
const WRAPPED_FLOOR = 5;

const WIDTHS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 360, height: 740 },
] as const;

type Scan = { texts: string[]; spills: { text: string; by: number }[] };

/** Runs in the page: every piece of text a user can meet, and each label that leaves its control's box. */
function scan(): Scan {
  const squash = (s: string) => s.replace(/\s+/g, " ").trim();
  const shown = (el: Element) =>
    el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  const texts = new Set<string>([squash(document.title)]);
  for (const el of document.body.querySelectorAll("*")) {
    if (el.closest("script, style, noscript, template")) continue;
    // A closed <select>'s options have no box of their own.
    const box = el instanceof HTMLOptionElement ? el.closest("select") : el;
    if (!box || !shown(box)) continue;
    // Adjacent text nodes are one sentence (React writes `a {b} c` as three).
    const own = [...el.childNodes]
      .map((node) => (node instanceof Text ? node.data : "\u0000"))
      .join("");
    for (const piece of own.split("\u0000")) texts.add(squash(piece));
    for (const attr of ["aria-label", "title", "placeholder", "alt"]) {
      texts.add(squash(el.getAttribute(attr) ?? ""));
    }
  }
  texts.delete("");

  const spills: Scan["spills"] = [];
  const controls = document.body.querySelectorAll(
    "button, a[href], summary, label, [role=button], [role=tab], [role=radio], [role=menuitem], [role=menuitemradio], [role=option], [role=switch], [role=checkbox]",
  );
  for (const control of controls) {
    if (!shown(control)) continue;
    const box = control.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    const walker = document.createTreeWalker(control, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = squash((node as Text).data);
      if (!text) continue;
      // Text for a screen reader alone sits in a 1px box by design.
      let hidden = false;
      for (
        let el = node.parentElement;
        el && el !== control.parentElement;
        el = el.parentElement
      ) {
        if (!shown(el) || el.offsetWidth <= 1 || el.offsetHeight <= 1)
          hidden = true;
      }
      if (hidden) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      let by = 0;
      for (const rect of range.getClientRects()) {
        by = Math.max(
          by,
          rect.right - box.right,
          box.left - rect.left,
          rect.bottom - box.bottom,
          box.top - rect.top,
        );
      }
      if (by > 1) spills.push({ text, by: Math.round(by) });
    }
  }
  return { texts: [...texts], spills };
}

/** A button or menu item by its English name, or by that name once it goes through the catalogue. */
const named = (english: string) =>
  new RegExp(`^(${escaped(english)}|${escaped(pseudo(english))})`);

/**
 * A weekday, a month, a half of the day and a year (shown only when it is not
 * this year's), each read as one fixed form, so the list does not change with
 * the day or the hour of the run, or how long ago the stack was seeded.
 */
const CALENDAR: [RegExp, string][] = [
  [/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)(?:[a-z]*day)?\b/g, "Mon"],
  [
    /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\b/g,
    "Jan",
  ],
  [/\b[AP]M\b/g, "AM"],
  [/\bJan 0\b(?!, 0)/g, "Jan 0, 0"],
];

const escaped = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

class Walk {
  /** Every string a 2xx API answer held: the account's own words, never a message. */
  private data = new Set<string>();
  private names: RegExp | null = null;
  readonly wrapped = new Set<string>();
  readonly unwrapped = new Set<string>();
  readonly spills: string[] = [];
  readonly writes: string[] = [];
  private asked = new Set<Request>();

  constructor(
    private page: Page,
    private testInfo: TestInfo,
  ) {
    const api = (request: Request) => request.url().startsWith(API_URL);
    page.on("request", (request) => {
      if (api(request)) this.asked.add(request);
    });
    for (const done of ["requestfinished", "requestfailed"] as const) {
      page.on(done, (request) => this.asked.delete(request));
    }
    // A page that loads again drops what the last one was waiting for, and
    // reports neither end.
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) this.asked.clear();
    });
    page.on("request", (request) => {
      if (
        !["GET", "HEAD", "OPTIONS"].includes(request.method()) &&
        // A POST that only reads: presigned urls for a place's photos.
        new URL(request.url()).pathname !== "/media/download-urls"
      )
        this.writes.push(`${request.method()} ${request.url()}`);
    });
    page.on("response", async (response) => {
      if (!response.url().startsWith(API_URL) || !response.ok()) return;
      const json: unknown = await response.json().catch(() => undefined);
      const add = (value: unknown) => {
        if (typeof value === "string") {
          const text = value.replace(/\s+/g, " ").trim();
          // A stored sentence the API wrote in the pseudo-language is a message.
          if (text.length > 2 && !text.includes("⟦")) this.data.add(text);
        } else if (value && typeof value === "object") {
          Object.values(value).forEach(add);
        }
      };
      add(json);
      this.names = null;
    });
  }

  /**
   * `text` with each message taken out (and counted), each seeded name
   * written `{}`, each number `0` and each date word as in `CALENDAR`; null
   * when the text is one string the API sent, or no letter is left, so it was
   * messages, the account's data and numbers only.
   *
   * ponytail: a label that is exactly a string the API sent (a place type the
   * seed names "Canyon") reads as data. Telling the two apart needs the API to
   * say which of its strings a user wrote.
   */
  private rest(text: string): string | null {
    if (this.data.has(text)) return null;
    // Inside a sentence only a name is taken out: a one-word lower-case string
    // is as likely an API keyword ("shared", "route") as the account's word.
    this.names ??= new RegExp(
      `(?<![\\p{L}\\p{N}])(?:${
        [...this.data]
          .filter((s) => !/^[a-z_]+$/.test(s))
          .sort((a, b) => b.length - a.length)
          .map(escaped)
          .join("|") || "(?!)"
      })(?![\\p{L}\\p{N}])`,
      "gu",
    );
    let rest = text
      .replace(/⟦[^⟦⟧]*⟧/g, (message) => {
        this.wrapped.add(message);
        return " ";
      })
      .replace(this.names, "{}")
      .replace(/\d+(?:[.,:]\d+)*/g, "0");
    for (const [word, fixed] of CALENDAR) rest = rest.replace(word, fixed);
    rest = rest.replace(/\s+/g, " ").trim();
    return /\p{L}/u.test(rest.replace(/\{\}/g, "")) ? rest : null;
  }

  /**
   * Record what `screen` shows once it has stopped changing: for a second, no
   * API request in flight and every look reading the same. (Not `networkidle`:
   * the map asks for tiles for as long as it likes.) A screen read too early
   * only misses text; it is text that arrives on some runs and not others that
   * would fail a run, since the list was written without it.
   */
  async see(screen: string) {
    const width = this.page.viewportSize()!.width;
    let found: Scan = { texts: [], spills: [] };
    let before = "";
    let quiet = 0;
    await expect(async () => {
      const asked = [...this.asked].map((request) => request.url());
      found = await this.page.evaluate(scan);
      const now = JSON.stringify(found);
      quiet = asked.length === 0 && now === before ? quiet + 1 : 0;
      before = now;
      expect(quiet, `${screen} keeps changing, or waits on ${asked}`).toBe(3);
    }).toPass({ intervals: [350], timeout: 30_000 });
    for (const text of found.texts) {
      const rest = this.rest(text);
      if (rest !== null) this.unwrapped.add(rest);
    }
    for (const spill of found.spills) {
      if (this.rest(spill.text) === null) continue;
      this.spills.push(
        `${screen} at ${width}px: “${spill.text}” leaves its control by ${spill.by}px`,
      );
    }
    await this.testInfo.attach(`${screen} at ${width}px`, {
      body: await this.page.screenshot(),
      contentType: "image/png",
    });
  }
}

// stubMaster builds the made-up archives when the map first asks for one, and
// building them blocks this process for seconds (10 to 40 on a loaded laptop).
// By then the page is up and its first `evaluate` is waiting on this process,
// so the screen is read as 30 s of silence. Built here, the cost falls in a
// hook, ahead of the page.
test.beforeAll(() => {
  test.setTimeout(180_000);
  statewideArchives();
});

test.beforeEach(async ({ page }) => {
  // `en-XA` is offered only where the simulated regions are on
  // (`offeredHere`, shared), and Logjam Web moves a kept language that is not
  // offered back to the source. This is the switch frontend/src/simRegions.ts
  // sets for a VITE_SIM_REGIONS=1 build, set here so the walk runs on the
  // server every other spec uses.
  await page.addInitScript(() => {
    (globalThis as { LOGJAM_SIM_REGIONS?: boolean }).LOGJAM_SIM_REGIONS = true;
  });
  // Running in a language the account has not recorded writes it to the
  // account (`useRecordLanguage`): the seeded account says it has, so the walk
  // writes nothing.
  await page.route(`${API_URL}/users/me`, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const user = await response.json();
    await route.fulfill({
      response,
      json: {
        ...user,
        uiPreferences: { ...user.uiPreferences, language: "en-XA" },
      },
    });
  });
  await stubMaster(page);
});

// Mutation: write `LANGUAGE_SETTING.title` in shared/src/contracts/settings.ts
// as "Language", without `t` (new text outside ⟦ ⟧: red on the list); or delete
// `import "./language"` from frontend/src/main.tsx (shared loads in English, so
// every message is new text outside ⟦ ⟧: red on the list too); or, rewriting the
// list, set `en-AU` for the key in the `pseudo` project of playwright.config.ts
// and for `language` in the `/users/me` stub in `beforeEach` (no message met:
// red on the floor).
test("every main screen reads in the pseudo-language, bar the listed text", async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  const walk = new Walk(page, testInfo);
  const aside = page.locator("aside");

  for (const { name, width, height } of WIDTHS) {
    const narrow = name === "phone";
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible({
      timeout: 15_000,
    });
    await walk.see("Map");

    await page.getByRole("button", { name: named("Layers") }).click();
    await expect(page.locator("[role=dialog]")).toBeVisible();
    await walk.see("Layers");
    await page.keyboard.press("Escape");

    const open = async (panel: string, inMore: boolean) => {
      if (narrow && inMore) {
        await page.getByRole("button", { name: named("More") }).click();
        if (panel === "Friends") await walk.see("More");
        await page.getByRole("menuitem", { name: named(panel) }).click();
      } else {
        await page
          .getByRole("navigation")
          .getByRole("button", { name: named(panel) })
          .click();
      }
      await expect(aside.getByRole("heading").first()).toBeVisible({
        timeout: 15_000,
      });
    };
    const close = async () => {
      if (narrow)
        await aside.getByRole("button", { name: named("Close") }).click();
    };

    await open("Places", false);
    await expect(aside.locator("[data-place-id]").first()).toBeVisible({
      timeout: 15_000,
    });
    await walk.see("Places");
    await aside
      .getByRole("button", { name: SEED_NAMES.claustral, exact: true })
      .click();
    await expect(
      aside.getByRole("heading", { name: SEED_NAMES.claustral }),
    ).toBeVisible();
    await walk.see("A place");
    await close();

    for (const [panel, inMore] of [
      ["Trips", false],
      ["Ways", false],
      ["Plans", false],
      ["Friends", true],
      ["Inbox", true],
      ["Account", true],
      ["Settings", true],
    ] as const) {
      await open(panel, inMore);
      await walk.see(panel);
      await close();
    }
  }

  const listed: string[] = JSON.parse(readFileSync(LIST, "utf8"));
  const seen = [...walk.unwrapped].sort();
  if (WRITE_LIST) {
    writeFileSync(LIST, `${JSON.stringify(seen, null, 2)}\n`);
  } else {
    expect(
      seen.filter((text) => !listed.includes(text)),
      `text on screen that did not go through the catalogue: write it with t, plural, rich or say (docs/decisions/0050-user-facing-text-goes-through-one-catalogue-function.md). Only if it is no message (a proper noun, a credit), add it to the list: ${REWRITE}`,
    ).toEqual([]);
  }
  expect(
    walk.writes,
    "the walk sent a request that is not a read: it shares the seeded account with the suites after it (frontend/AGENTS.md, Testing)",
  ).toEqual([]);
  expect(
    walk.wrapped.size,
    `the walk met ${walk.wrapped.size} messages in ⟦ ⟧: did Logjam Web start in the pseudo-language?`,
  ).toBeGreaterThanOrEqual(WRAPPED_FLOOR);
  expect(
    walk.spills,
    "a label is wider than its control in the pseudo-language, so a translation would be too",
  ).toEqual([]);
});

// Mutation: have `scan` skip the `rect.right - box.right` term.
test("a label wider than its button is found", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible({
    timeout: 15_000,
  });
  await page.evaluate(() => {
    const button = document.createElement("button");
    button.style.cssText =
      "position:fixed;top:0;left:0;width:40px;white-space:nowrap;z-index:9999";
    button.textContent = "A label far too long for forty pixels";
    document.body.append(button);
  });
  const { spills } = await page.evaluate(scan);
  expect(spills.map((spill) => spill.text)).toContain(
    "A label far too long for forty pixels",
  );
});
