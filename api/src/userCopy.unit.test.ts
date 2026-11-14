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
// A say written outside any function or class runs when its module loads, in
// the language the process started in; the API's language is per request.
const atImport: string[] = [];

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

  const visit = (node: ts.Node, inFunction = false): void => {
    if (ts.isTaggedTemplateExpression(node) && node.tag.getText() === "say") {
      if (!inFunction) atImport.push(at(node));
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
    const inside =
      inFunction || ts.isFunctionLike(node) || ts.isClassLike(node);
    ts.forEachChild(node, (child) => visit(child, inside));
  };
  visit(sf);
}

describe("the sentences the API sends", () => {
  it("are found at all — a silent zero would pass forever", () => {
    // About 295 sentences today: 245 in api/src, 50 in shared/src. The floors
    // sit well under each, so a few sentences can go, but a directory the
    // scan stops reaching cannot.
    const inShared = sentences.filter((s) => s.where.startsWith("shared/"));
    expect(sentences.length - inShared.length).toBeGreaterThan(200);
    expect(inShared.length).toBeGreaterThan(40);
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

  // Mutation: write `const GONE = say`Couldn't find that.`;` at the top of any
  // file under api/src or shared/src, and it fails here, naming the file.
  it("are never a say literal outside a function", () => {
    expect(
      atImport,
      "A say literal outside a function is evaluated when its module loads, in " +
        "English, but the API's language is per request. Make the sentence a " +
        "function and call it where it is thrown (docs/decisions/0033-the-api-writes-the-sentence-a-user-reads.md).",
    ).toEqual([]);
  });

  it("reach a response only through say`…`", () => {
    expect(offences).toEqual([]);
  });
});
