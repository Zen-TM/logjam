import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { TEXT_ROLES } from "@logjam/shared";
import { describe, expect, it } from "vitest";

// frontend/DESIGN.md §1: "Every text style is a role." A stylesheet takes one
// with `composes: <role> from "…/textRoles.generated.module.css"` (generated
// from TEXT_ROLES by `npm run tokens`) and never writes `font-size` or
// `font-weight` itself, so two kinds of text cannot drift apart by a pixel and
// a role's size changes in one place.
//
// Mutations that turn it red: add `font-size: var(--font-sm);` to any
// stylesheet not listed; or give an element two role classes (`className=
// {`${classes.title} ${classes.hint}`}` where both compose a role), which the
// generated file's order then decides.
const SRC = dirname(fileURLToPath(import.meta.url));
const GENERATED = "textRoles.generated.module.css";

/** A size written outside the generated file, with the reason it has no role. */
const ALLOWED: { file: string; reason: string }[] = [
  {
    file: "index.css",
    reason:
      "the document's own size: unstyled text inherits it and every role is rem from it",
  },
  {
    file: "components/map/Map.module.css",
    reason:
      "MapLibre's own scale-bar element, which has no class of ours to compose onto",
  },
  {
    file: "components/plans/PlanSummary.module.css",
    reason:
      "the print summary's paper sizes, in points on an A4 page: the roles are rem for a screen",
  },
];

function files(dir: string, ext: RegExp): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return files(path, ext);
    return ext.test(entry.name) ? [path] : [];
  });
}

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** `font-size`/`font-weight`/`font` declarations that pick a value (not `inherit`). */
function picks(css: string): string[] {
  return [
    ...stripComments(css).matchAll(
      /(?<![\w-])(font-size|font-weight|font)\s*:\s*([^;}]+)/g,
    ),
  ]
    .filter((m) => m[2].trim() !== "inherit")
    .map((m) => m[0].trim());
}

const stylesheets = files(SRC, /\.css$/)
  .map((path) => relative(SRC, path))
  .filter((file) => file !== GENERATED && file !== "tokens.generated.css");

describe("every text style is a role", () => {
  it("sees a size, and not the word in a comment or an inherit", () => {
    expect(picks("a { font-size: var(--font-sm); }")).toHaveLength(1);
    expect(picks("a { font-weight: 600; }")).toHaveLength(1);
    expect(picks("a { font: 14px serif; }")).toHaveLength(1);
    expect(picks("/* font-size: 12px */ a { font: inherit; }")).toEqual([]);
    expect(picks("a { font-family: inherit; line-height: 1; }")).toEqual([]);
  });

  it("is true of every stylesheet but those listed", () => {
    const offenders = stylesheets.flatMap((file) =>
      ALLOWED.some((a) => a.file === file)
        ? []
        : picks(readFileSync(join(SRC, file), "utf8")).map(
            (decl) => `${file}: ${decl}`,
          ),
    );
    expect(offenders).toEqual([]);
  });

  it("lists only stylesheets that still write one", () => {
    const stale = ALLOWED.filter(
      (a) => picks(readFileSync(join(SRC, a.file), "utf8")).length === 0,
    );
    expect(stale).toEqual([]);
  });

  it("has no inline size or weight", () => {
    const offenders = files(SRC, /\.tsx?$/)
      .filter((path) => !/\.test\.tsx?$/.test(path))
      .filter((path) =>
        /\bfontSize\b|\bfontWeight\b/.test(readFileSync(path, "utf8")),
      )
      .map((path) => relative(SRC, path));
    expect(offenders).toEqual([]);
  });

  it("composes only roles the declaration has", () => {
    const webRoles = Object.keys(TEXT_ROLES);
    const used = new Set(
      stylesheets.flatMap((file) =>
        [
          ...readFileSync(join(SRC, file), "utf8").matchAll(
            /composes:\s*(\w+)\s+from\s+"[^"]*textRoles\.generated\.module\.css"/g,
          ),
        ].map((m) => m[1]),
      ),
    );
    expect([...used].filter((name) => !webRoles.includes(name))).toEqual([]);
  });

  it("puts one role on an element", () => {
    const offenders: string[] = [];
    for (const tsx of files(SRC, /\.tsx$/)) {
      const source = readFileSync(tsx, "utf8");
      for (const [, name, rel] of source.matchAll(
        /import (\w+) from "(\.[^"]+\.module\.css)"/g,
      )) {
        let css: string;
        try {
          css = readFileSync(join(dirname(tsx), rel), "utf8");
        } catch {
          continue;
        }
        // A class that composes a role: `.name { composes: role from "…"; }`.
        const roleOf = new Map<string, string>();
        for (const [, cls, body] of stripComments(css).matchAll(
          /\.([\w-]+)\s*\{([^{}]*)\}/g,
        )) {
          const role = /composes:\s*(\w+)\s+from\s+"[^"]*textRoles\./.exec(
            body,
          );
          if (role) roleOf.set(cls, role[1]);
        }
        for (const m of source.matchAll(
          /className=\{([\s\S]*?)\}(?=\s|\/|>)/g,
        )) {
          // A ternary picks one of its arms, so only a plain list is checked.
          if (m[1].includes("?")) continue;
          const roles = new Set(
            [...m[1].matchAll(new RegExp(`\\b${name}\\.(\\w+)`, "g"))]
              .map((x) => roleOf.get(x[1]))
              .filter(Boolean),
          );
          if (roles.size > 1)
            offenders.push(`${relative(SRC, tsx)}: ${[...roles].join(" + ")}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
