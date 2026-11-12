import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

// queryPlans.test.ts and routeAuth.unit.test.ts read every route from
// ROUTER_MOUNTS, so a router index.ts mounted itself would skip both. index.ts
// may mount routers only in its one `for ... of ROUTER_MOUNTS` loop; the rest of
// its `app.use` calls are these middleware, and its `app.get` probes are held
// by routeAuth.unit.test.ts.
//
// Mutation that turns it red: import a router from ./routes/<name> in index.ts;
// an inline `Router()` mounted with app.use("/x", r); a router imported from
// outside routes/; app.use("/x", ...) or app.route("/x") anywhere in index.ts;
// import("./routes/<name>").then(...).
const MIDDLEWARE = new Set([
  "lifecycle.closeConnections",
  "pinoHttp",
  "cors",
  "helmet",
  "express.json",
  "globalLimiter",
  "errorHandler",
]);

const source = readFileSync(join(__dirname, "../index.ts"), "utf8");
const sf = ts.createSourceFile(
  "index.ts",
  source,
  ts.ScriptTarget.Latest,
  true,
);
const offences: string[] = [];
let mountLoops = 0;
const at = (n: ts.Node) =>
  `index.ts:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;

const visit = (node: ts.Node): void => {
  if (
    ts.isImportDeclaration(node) &&
    ts.isStringLiteral(node.moduleSpecifier) &&
    /^\.\/routes\/(?!mounts$)/.test(node.moduleSpecifier.text)
  )
    offences.push(`${at(node)}: imports a router; list it in routes/mounts.ts`);
  if (
    ts.isCallExpression(node) &&
    (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      node.expression.getText() === "require")
  )
    offences.push(
      `${at(node)}: a dynamic import hides a router from the guards`,
    );
  if (
    ts.isCallExpression(node) &&
    /(^|\.)Router$/.test(node.expression.getText())
  )
    offences.push(
      `${at(node)}: a router defined in index.ts; put it in routes/`,
    );
  if (ts.isCallExpression(node) && node.expression.getText() === "app.route")
    offences.push(
      `${at(node)}: app.route; put the route in a router in routes/`,
    );
  if (ts.isCallExpression(node) && node.expression.getText() === "app.use") {
    const [first, second] = node.arguments;
    const loop = ts.findAncestor(node, ts.isForOfStatement);
    if (second !== undefined) {
      if (loop?.expression.getText() === "ROUTER_MOUNTS") mountLoops++;
      else
        offences.push(
          `${at(node)}: app.use(path, …) outside the ROUTER_MOUNTS loop`,
        );
    } else if (
      !ts.isArrowFunction(first) &&
      !MIDDLEWARE.has(
        ts.isCallExpression(first)
          ? first.expression.getText()
          : first.getText(),
      )
    )
      offences.push(
        `${at(node)}: app.use(${first.getText()}) is not a listed middleware`,
      );
  }
  ts.forEachChild(node, visit);
};
visit(sf);

it("index.ts takes its routers only from ROUTER_MOUNTS", () => {
  expect(
    offences,
    "mount a router by adding it to ROUTER_MOUNTS in routes/mounts.ts; " +
      "a new middleware in index.ts goes in this test's MIDDLEWARE list",
  ).toEqual([]);
  expect(mountLoops, "index.ts must mount ROUTER_MOUNTS exactly once").toBe(1);
});
