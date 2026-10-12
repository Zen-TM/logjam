import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { apiSentenceViolations, copySay } from "@logjam/shared";

// Any text the API sends that a client may show is user copy, written once,
// here (shared/DESIGN.md §11). The type does most of it: `AppError` takes a
// `UserSentence` and only say`…` makes one (errorHandler.ts fails the build if
// that is widened). This file holds what the type cannot: what the sentences
// say, and the ways round the type.
//
// Mutation that turns it red: change any sentence to
// say`placeTypeId is required`.

const API_SRC = join(__dirname);
const SHARED_SRC = join(__dirname, "../../shared/src");
const REPO = join(__dirname, "../..");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== "__tests__" && name !== "__fixtures__")
        sourceFiles(path, out);
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(path);
    }
  }
  return out;
}

type Found = { where: string; text: string };

const sentences: Found[] = [];
const offences: string[] = [];

for (const file of [...sourceFiles(API_SRC), ...sourceFiles(SHARED_SRC)]) {
  const inApi = file.startsWith(API_SRC);
  const name = relative(REPO, file);
  const sf = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const at = (node: ts.Node) =>
    `${name}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
  const isText = (node: ts.Node) =>
    ts.isStringLiteralLike(node) || ts.isTemplateExpression(node);

  const visit = (node: ts.Node): void => {
    if (ts.isTaggedTemplateExpression(node) && node.tag.getText() === "say") {
      const template = node.template;
      sentences.push({
        where: at(node),
        text: ts.isNoSubstitutionTemplateLiteral(template)
          ? template.text
          : template.head.text +
            template.templateSpans.map((s) => `…${s.literal.text}`).join(""),
      });
    }
    // say("…") or say(variable): the tag is the only way in.
    if (ts.isCallExpression(node) && node.expression.getText() === "say")
      offences.push(`${at(node)}: call say as a tag, say\`…\``);
    if (
      (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) &&
      node.type.getText() === "UserSentence" &&
      name !== "shared/src/userSentence.ts"
    )
      offences.push(`${at(node)}: a cast to UserSentence skips say\`…\``);
    if (inApi && ts.isPropertyAssignment(node)) {
      const key = node.name.getText();
      // A response's `error` is written by errorHandler alone.
      if (
        key === "error" &&
        ts.isObjectLiteralExpression(node.parent) &&
        ts.isCallExpression(node.parent.parent) &&
        /\.json$/.test(node.parent.parent.expression.getText()) &&
        name !== "api/src/middleware/errorHandler.ts"
      )
        offences.push(`${at(node)}: throw an AppError instead of res.json`);
      // A job's stored failure text is shown in both clients' lists.
      if (key === "errorMessage" && isText(node.initializer))
        offences.push(`${at(node)}: errorMessage is user copy, say\`…\``);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

describe("the sentences the API sends", () => {
  it("are found at all — a silent zero would pass forever", () => {
    expect(sentences.length).toBeGreaterThan(150);
  });

  it("recognises developer wording", () => {
    const broken = (text: string) => apiSentenceViolations(text);
    expect(broken("placeTypeId is required")).toContain("field-key");
    expect(broken("Unknown field: …")).toContain("not-a-sentence");
    expect(broken("ops[…].opId is required")).toContain("field-key");
    expect(broken("… must be a UUIDv4")).toContain("developer-wording");
    expect(broken("Invalid position.")).toContain("developer-wording");
    expect(broken("Update Logjam GPS to sync.")).toContain("names-a-client");
    expect(broken("Couldn't find that place.")).toEqual([]);
    expect(broken("“…” is the name of a built-in attribute.")).toEqual([]);
  });

  it("are written for the person reading them", () => {
    expect(
      sentences.flatMap(({ where, text }) =>
        apiSentenceViolations(text).map(
          (id) => `${where}: "${text}" — ${copySay(id)}`,
        ),
      ),
    ).toEqual([]);
  });

  it("reach a response only through say`…`", () => {
    expect(offences).toEqual([]);
  });
});
