import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Rules in api/AGENTS.md that a scan of the source can hold, one declaration
// each; `console.*` is held by `no-console` in eslint.config.mjs instead.
// Every allow-list entry carries its reason. The scans read the whole of
// api/src except tests, with `typescript`'s parser as userCopy.unit.test.ts does.
//
// Mutation that turns each red (put it in a file under src/routes or src/lib):
//   errors:   res.status(400).send("x"), res.status(500).json({}), res.sendStatus(404),
//             or throw new Error("x") under routes/
//   env:      process.env.SOMETHING in a file not listed in READS_PROCESS_ENV
//   aws:      new SecretsManagerClient({}) (or any @aws-sdk client) outside the lists
//   subject:  prisma.user.findUnique({ where: { subject: sub } }) in a file not listed

const SRC = join(__dirname);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== "__tests__" && name !== "__fixtures__")
        sourceFiles(path, out);
    } else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) out.push(path);
  }
  return out;
}

const files = sourceFiles(SRC).map((path) => ({
  rel: relative(SRC, path),
  sf: ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  ),
}));

/** Each node `pick` returns for a file, as "file:line: text". */
function find(
  pick: (node: ts.Node, sf: ts.SourceFile, rel: string) => string | undefined,
): { rel: string; where: string }[] {
  const out: { rel: string; where: string }[] = [];
  for (const { rel, sf } of files) {
    const visit = (node: ts.Node): void => {
      const text = pick(node, sf, rel);
      if (text !== undefined) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        out.push({ rel, where: `${rel}:${line}: ${text}` });
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return out;
}

const outside = (hits: { rel: string; where: string }[], allowed: string[]) =>
  hits.filter((h) => !allowed.includes(h.rel)).map((h) => h.where);

// A listed file that has no hit any more is a stale entry.
const unused = (hits: { rel: string }[], allowed: string[]) =>
  allowed.filter((f) => !hits.some((h) => h.rel === f));

it("scans the source tree at all — an empty scan would pass forever", () => {
  expect(files.length).toBeGreaterThan(100);
});

describe("errors are AppError", () => {
  // The platform's own probes and the handler that writes every error body.
  const MAY_WRITE_ERRORS = ["index.ts", join("middleware", "errorHandler.ts")];
  const responses = find((node) => {
    if (!ts.isCallExpression(node)) return undefined;
    const callee = node.expression.getText();
    if (callee === "res.status" || callee === "res.sendStatus") {
      const [arg] = node.arguments;
      const bad =
        arg &&
        [arg, ...allDescendants(arg)].some(
          (n) => ts.isNumericLiteral(n) && Number(n.text) >= 400,
        );
      return bad ? `${callee}(${arg.getText()})` : undefined;
    }
    return undefined;
  });
  const bareErrors = find((node, _sf, rel) =>
    rel.split(sep)[0] === "routes" &&
    ts.isThrowStatement(node) &&
    ts.isNewExpression(node.expression) &&
    node.expression.expression.getText() === "Error"
      ? node.getText()
      : undefined,
  );

  it("is found at the handler at all", () => {
    expect(responses.some((h) => h.rel.endsWith("errorHandler.ts"))).toBe(true);
  });

  it("sends no error response outside the handler and the probes", () => {
    expect(
      outside(responses, MAY_WRITE_ERRORS),
      "throw new AppError(status, say`…`) (middleware/errorHandler.ts) and let " +
        "the handler answer: an upstream that refused is 502, a dependency we own " +
        "that is missing is 503",
    ).toEqual([]);
  });

  it("throws no bare Error from a route", () => {
    expect(
      bareErrors.map((h) => h.where),
      "throw new AppError(status, say`…`) instead: a bare Error is a 500 with " +
        "no sentence for the user",
    ).toEqual([]);
  });
});

function allDescendants(node: ts.Node): ts.Node[] {
  const out: ts.Node[] = [];
  const walk = (n: ts.Node) => {
    out.push(n);
    ts.forEachChild(n, walk);
  };
  ts.forEachChild(node, walk);
  return out;
}

describe("env is read through getEnv()", () => {
  const READS_PROCESS_ENV: Record<string, string> = {
    "index.ts": "loads dotenv before anything else, from NODE_ENV",
    [join("lib", "env.ts")]: "getEnv() itself, and the schema's own checks",
    [join("lib", "databaseUrl.ts")]:
      "the one reader of DB_*: migrate, seed and boot-time credentials use it with no validated env yet",
    [join("lib", "dbConnection.ts")]:
      "the pool's TLS settings, built when services/prisma.ts loads and by workers that never call getEnv()",
    [join("lib", "dbPassword.ts")]:
      "resolves the password at each new connection; the boot-time resolvers write DB_PASSWORD",
    [join("lib", "resolveDbCredentials.ts")]:
      "boot.ts runs it before getEnv(): it writes the DB_USER and DB_PASSWORD getEnv() then validates",
    [join("lib", "resolveOriginVerifySecret.ts")]:
      "boot.ts runs it before getEnv(): it writes the secret getEnv() then validates",
    [join("lib", "resolveSmtpPassword.ts")]:
      "boot.ts runs it before getEnv(): it writes the password getEnv() then validates",
    [join("middleware", "auth.ts")]:
      "a second lock at module load that fails closed independently of validateEnv (middleware/auth.unit.test.ts)",
    [join("middleware", "rateLimit.ts")]:
      "the CI override is ignored in production and read when the module is imported, before index.ts has wired up (middleware/rateLimit.unit.test.ts)",
    [join("services", "awsClients.ts")]:
      "the clients are built at import, with the region and local endpoint",
    [join("services", "prisma.ts")]:
      "the client's log level, set when it is built at import",
  };
  const reads = find((node) =>
    ts.isPropertyAccessExpression(node) && node.getText() === "process.env"
      ? node.getText()
      : undefined,
  );

  it("reads process.env only in the declared files", () => {
    expect(
      outside(reads, Object.keys(READS_PROCESS_ENV)),
      "read it through getEnv() (lib/env.ts) and declare a new variable in its " +
        "schema. A file that runs before getEnv() can, goes in READS_PROCESS_ENV with its reason",
    ).toEqual([]);
    expect(
      unused(reads, Object.keys(READS_PROCESS_ENV)),
      "no longer reads process.env: remove it from READS_PROCESS_ENV",
    ).toEqual([]);
  });
});

describe("AWS clients are the singletons in services/awsClients.ts", () => {
  // They run in boot.ts before getEnv() and read AWS_ENDPOINT_URL when called.
  // Moving them into awsClients.ts would build the S3, ECS and Cognito clients
  // and fix the endpoint at import, in the boot path, and change what each
  // resolver's unit test mocks.
  const BOOT_TIME_SECRETS_CLIENT =
    "boot-time secret read; runs before getEnv() and builds its client when called";
  const OWN_CLIENT: Record<string, string> = {
    [join("services", "awsClients.ts")]: "the singletons themselves",
    [join("lib", "dbPassword.ts")]: BOOT_TIME_SECRETS_CLIENT,
    [join("lib", "resolveDbCredentials.ts")]: BOOT_TIME_SECRETS_CLIENT,
    [join("lib", "resolveOriginVerifySecret.ts")]: BOOT_TIME_SECRETS_CLIENT,
    [join("lib", "resolveSmtpPassword.ts")]: BOOT_TIME_SECRETS_CLIENT,
  };
  const built = find((node, sf) => {
    if (!ts.isNewExpression(node) || !ts.isIdentifier(node.expression))
      return undefined;
    const name = node.expression.text;
    if (!name.endsWith("Client")) return undefined;
    const fromSdk = sf.statements.some(
      (s) =>
        ts.isImportDeclaration(s) &&
        ts.isStringLiteral(s.moduleSpecifier) &&
        s.moduleSpecifier.text.startsWith("@aws-sdk/client-") &&
        s.importClause?.namedBindings &&
        ts.isNamedImports(s.importClause.namedBindings) &&
        s.importClause.namedBindings.elements.some((e) => e.name.text === name),
    );
    return fromSdk ? node.getText() : undefined;
  });

  it("builds a client nowhere else", () => {
    expect(built.length).toBeGreaterThan(3);
    expect(
      outside(built, Object.keys(OWN_CLIENT)),
      "import the client from services/awsClients.ts: it honours " +
        "AWS_ENDPOINT_URL, so local dev stays on MiniStack. A boot-time file " +
        "that cannot goes in OWN_CLIENT with its reason",
    ).toEqual([]);
    expect(
      unused(built, Object.keys(OWN_CLIENT)),
      "no longer builds a client: remove it from OWN_CLIENT",
    ).toEqual([]);
  });
});

describe("a user is never looked up by subject inline", () => {
  const MAY_LOOK_UP_SUBJECT: Record<string, string> = {
    [join("lib", "resolveUser.ts")]: "the lookup every handler goes through",
    [join("routes", "users.ts")]:
      "provisioning, the account rebind and the account delete, which find the row by subject on purpose",
  };
  const lookups = find((node) => {
    if (
      !(
        ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)
      ) ||
      node.name.getText() !== "subject"
    )
      return undefined;
    const object = node.parent;
    const owner = object.parent;
    return ts.isPropertyAssignment(owner) && owner.name.getText() === "where"
      ? node.getText()
      : undefined;
  });

  it("looks one up only in resolveUser and the account routes", () => {
    expect(lookups.length).toBeGreaterThan(3);
    expect(
      outside(lookups, Object.keys(MAY_LOOK_UP_SUBJECT)),
      "call resolveUser(req.user!.sub) (lib/resolveUser.ts) for the internal user",
    ).toEqual([]);
  });
});
