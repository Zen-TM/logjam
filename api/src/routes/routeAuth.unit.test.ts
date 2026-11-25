// Guard for api/AGENTS.md and the root Privacy rule: no unauthenticated
// endpoint serves user data. Auth is attached route by route, so a route that
// forgets `requireAuth` passes every integration test (they run under fake
// auth). This walks the Express stack of every router in ROUTER_MOUNTS,
// nested routers included, plus the routes index.ts registers on `app`.
//
// Mutation that turns it red: delete `requireAuth` from any route, mount a
// router with a route that has none, or register an `app.get` in index.ts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { expect, it, vi } from "vitest";

vi.mock("../services/prisma", () => ({ default: {} }));

import { requireAuth } from "../middleware/auth";
import { ROUTER_MOUNTS } from "./mounts";

type Layer = {
  handle: { stack?: Layer[] } & ((...args: unknown[]) => unknown);
  route?: { path: string; methods: Record<string, boolean>; stack: Layer[] };
};

const ALL_METHODS = (methods: Record<string, boolean>) =>
  Object.keys(methods)
    .filter((m) => methods[m])
    .map((m) => m.toUpperCase())
    .join("+") || "ALL";

/** "METHOD /path" of every route in a router and whether it runs requireAuth. */
function walk(
  stack: Layer[],
  prefix: string,
  authedByUse: boolean,
  out: { route: string; authed: boolean }[],
) {
  let authed = authedByUse;
  for (const layer of stack) {
    if (layer.route) {
      out.push({
        route: `${ALL_METHODS(layer.route.methods)} ${prefix}${layer.route.path === "/" ? "" : layer.route.path}`,
        authed:
          authed || layer.route.stack.some((l) => l.handle === requireAuth),
      });
    } else if (layer.handle === requireAuth) {
      authed = true; // router.use(requireAuth) covers what is registered after it
    } else if (layer.handle.stack) {
      walk(layer.handle.stack, `${prefix}/…`, authed, out);
    }
  }
}

const routes: { route: string; authed: boolean }[] = [];
for (const [mount, router] of ROUTER_MOUNTS)
  walk((router as unknown as { stack: Layer[] }).stack, mount, false, routes);

// Every route that runs no requireAuth, each with the reason it may. A route
// not listed here must run requireAuth; to add one, it needs the same kind of
// reason as these and a line in api/AGENTS.md.
const OPEN_ROUTES: Record<string, string> = {
  "GET /meta":
    "a build too old to authenticate must still be told it is stale; server constants only",
  "GET /meta/min-mobile-version":
    "the same stale-build answer, as a bare version",
  "GET /users/username-available":
    "the sign-up form asks before an account exists; a yes or no, with its own limiter",
};

// Routes index.ts registers on `app` itself, outside the routers.
const OPEN_APP_ROUTES: Record<string, string> = {
  "GET /health": "the platform's liveness probe; no user data",
  "GET /ready": "the platform's readiness probe; no user data",
};

it("walks every mounted route — a silent zero would pass forever", () => {
  expect(routes.length).toBeGreaterThan(120);
});

it("runs requireAuth on every route except the declared open ones", () => {
  const open = routes.filter((r) => !r.authed).map((r) => r.route);
  expect(
    open.sort(),
    "a route without requireAuth is open to the internet. Add requireAuth " +
      "(middleware/auth.ts) to it; only a route with a reason of the same kind " +
      "as OPEN_ROUTES' (and a line in api/AGENTS.md) goes in that list",
  ).toEqual(Object.keys(OPEN_ROUTES).sort());
});

it("registers on app only the declared probes, besides the router mounts", () => {
  const source = readFileSync(join(__dirname, "../index.ts"), "utf8");
  const sf = ts.createSourceFile(
    "index.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const registered: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.expression.getText() === "app" &&
      /^(get|post|put|patch|delete|all|head|options)$/.test(
        node.expression.name.text,
      )
    ) {
      const [path] = node.arguments;
      registered.push(
        `${node.expression.name.text.toUpperCase()} ${path && ts.isStringLiteralLike(path) ? path.text : "<computed>"}`,
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  expect(
    registered.sort(),
    "index.ts may register only the platform probes; a route belongs in a " +
      "router in routes/ with requireAuth, mounted through routes/mounts.ts",
  ).toEqual(Object.keys(OPEN_APP_ROUTES).sort());
});
