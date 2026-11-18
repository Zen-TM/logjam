import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { afterAll, describe, expect, it, vi } from "vitest";

// A message `shared` writes outside any function is written when the module
// loads, in the language the process started in, and the API's language is per
// request (docs/decisions/0050-user-facing-text-goes-through-one-catalogue-function.md).
// So no `shared` export the API imports may hold such text. This loads `shared`
// as a process that started in the pseudo-language, then reads in English, and
// fails on any text still in pseudo: that was frozen at load.
//
// Mutation that turns it red: in shared/src/contracts/inbox.ts, write
// `untitled` in `ANNOUNCEMENT` as a plain property, `untitled: t`A message from
// the Logjam maintainer``. It reads exports as values and calls nothing, so a
// function that reads a module-level table (`placeKindLabel`) is held by
// shared/src/placeRegistry.test.ts instead. Or, for the floor, change the
// module name `importedNames` matches to `@logjam/sharedd`.

const API = join(__dirname, "..");

/** Paths in what the API imports that hold frozen text it never sends to a user, with why. */
const SAFE: Record<string, string> = {
  WORKER_SPECS: "the API reads the vCPU numbers, never the labels",
  REGIONS:
    "the API reads ids, licences and registry paths from a region's declaration, never its vocabulary",
  TOPO_LAYERS: "the API reads each layer's name and format, never its label",
  "ANNOUNCEMENT.from":
    "the inbox row's subline, which the clients read; the API reads `untitled`, a getter",
};

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (!["__tests__", "__fixtures__", "node_modules", "dist"].includes(name))
        sources(path, out);
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(path);
    }
  }
  return out;
}

/** Every name the API's sources import, or re-export, as a value from `@logjam/shared`. */
function importedNames(): Map<string, string> {
  const names = new Map<string, string>();
  for (const dir of ["src", "prisma"]) {
    for (const file of sources(join(API, dir))) {
      const sf = ts.createSourceFile(
        file,
        readFileSync(file, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      for (const statement of sf.statements) {
        // `export { X } from "@logjam/shared"` hands the value on to the API's own files.
        if (
          ts.isExportDeclaration(statement) &&
          statement.moduleSpecifier &&
          ts.isStringLiteral(statement.moduleSpecifier) &&
          statement.moduleSpecifier.text === "@logjam/shared" &&
          !statement.isTypeOnly &&
          statement.exportClause &&
          ts.isNamedExports(statement.exportClause)
        )
          for (const element of statement.exportClause.elements)
            if (!element.isTypeOnly)
              names.set(
                (element.propertyName ?? element.name).text,
                relative(API, file),
              );
        if (
          !ts.isImportDeclaration(statement) ||
          !ts.isStringLiteral(statement.moduleSpecifier) ||
          statement.moduleSpecifier.text !== "@logjam/shared" ||
          statement.importClause?.isTypeOnly
        )
          continue;
        const bindings = statement.importClause?.namedBindings;
        if (!bindings || !ts.isNamedImports(bindings)) continue;
        for (const element of bindings.elements)
          if (!element.isTypeOnly)
            names.set(
              (element.propertyName ?? element.name).text,
              relative(API, file),
            );
      }
    }
  }
  return names;
}

const PSEUDO = /⟦.*⟧/su;

/** Where a pseudo-language string sits in `value`: strings, arrays and plain objects are read, nothing is called. */
function frozen(
  value: unknown,
  path: string,
  seen = new Set<object>(),
): string[] {
  if (typeof value === "string") return PSEUDO.test(value) ? [path] : [];
  if (typeof value !== "object" || value === null || seen.has(value)) return [];
  seen.add(value);
  const proto = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && proto !== Object.prototype && proto !== null)
    return [];
  return Object.entries(value).flatMap(([key, item]) =>
    frozen(item, `${path}.${key}`, seen),
  );
}

describe("what the API imports from @logjam/shared", () => {
  afterAll(() => {
    delete (globalThis as { LOGJAM_LANGUAGE?: string }).LOGJAM_LANGUAGE;
  });

  it("holds no text frozen in the language the process started in", async () => {
    vi.resetModules();
    (globalThis as { LOGJAM_LANGUAGE?: string }).LOGJAM_LANGUAGE = "en-XA";
    const shared = (await import("@logjam/shared")) as Record<
      string,
      unknown
    > & {
      setLanguageResolver(read: () => string | undefined): void;
    };
    shared.setLanguageResolver(() => "en-AU");

    const names = importedNames();
    // 237 names today, most of them functions, which are not read: a scan that stopped matching would pass over nothing.
    expect(names.size).toBeGreaterThan(200);

    const safe = (path: string) =>
      Object.keys(SAFE).some(
        (key) => path === key || path.startsWith(`${key}.`),
      );
    const offenders = [...names].flatMap(([name, file]) =>
      frozen(shared[name], name)
        .filter((path) => !safe(path))
        .map((path) => `${path} (imported in ${file})`),
    );
    expect(
      offenders,
      "text written when shared loads stays in that language for every request: make it a function or a getter, or list the export in SAFE with why the API never sends it",
    ).toEqual([]);

    expect(
      Object.keys(SAFE).filter((path) => !names.has(path.split(".")[0])),
      "an entry in SAFE that the API no longer imports",
    ).toEqual([]);
  });
});
