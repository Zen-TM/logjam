// Guards the pre sign-up cap. DynamoDB is a fake: the command it receives and
// the error it throws are what is under test, not the SDK.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import type { PreSignUpTriggerEvent } from "aws-lambda";
import { CAP_MESSAGE, clientConfig, DEADLINE_MS, makeHandler } from "./index.js";

const SECRET = "someone.private@example.test";

function event(triggerSource = "PreSignUp_SignUp"): PreSignUpTriggerEvent {
  return {
    triggerSource,
    userName: SECRET,
    request: { userAttributes: { email: SECRET, name: "Private Person" } },
    response: {
      autoConfirmUser: false,
      autoVerifyEmail: false,
      autoVerifyPhone: false,
    },
  } as unknown as PreSignUpTriggerEvent;
}

// Every path that returns the event must leave Cognito's three decisions as it
// found them: auto-confirming a sign-up skips the email code, and the fail-open
// paths are where an edit is most likely and does most harm.
const FLAGS_OFF = { autoConfirmUser: false, autoVerifyEmail: false, autoVerifyPhone: false };
function untouched(out: PreSignUpTriggerEvent): PreSignUpTriggerEvent {
  assert.deepEqual(out.response, FLAGS_OFF);
  return out;
}

type Cmd = { constructor: { name: string }; input: Record<string, unknown> };

function fake(behave: (n: number) => unknown) {
  const sent: Cmd[] = [];
  return {
    sent,
    client: {
      send: async (cmd: Cmd) => {
        sent.push(cmd);
        return behave(sent.length);
      },
    } as never,
  };
}

const counted = (n: number) => ({ Attributes: { n: { N: String(n) } } });
const capReached = () => {
  throw Object.assign(new Error("The conditional request failed"), {
    name: "ConditionalCheckFailedException",
  });
};

let t = Date.UTC(2026, 10, 10, 12);
const now = () => new Date(t);
const make = (client: never, cap = 3) =>
  makeHandler({ client, table: "tbl", cap, now });

let logged: string[] = [];
const real = { log: console.log, warn: console.warn, error: console.error, info: console.info };
beforeEach(() => {
  t = Date.UTC(2026, 10, 10, 12);
  logged = [];
  const grab = (...a: unknown[]) => void logged.push(JSON.stringify(a));
  console.log = console.warn = console.error = console.info = grab;
});
afterEach(() => Object.assign(console, real));

// Mutation: set autoConfirmUser or autoVerifyEmail (or autoVerifyPhone) to true
// on any returning path: the counted one, the uncounted-source branch, the
// fail-open catch, the misconfigured guard or the deadline. Each test below
// that returns the event reads the flags through `untouched`.
//
// Mutation: change the signup_counted payload (the metric filter in cognito_signup_cap.tf reads
// message.msg and message.n).
test("under the cap: returns the event unchanged and logs only the count and cap", async () => {
  const f = fake(() => counted(2));
  const e = event();
  const out = untouched(await make(f.client)(e));
  assert.equal(out, e);
  assert.deepEqual(logged, [JSON.stringify([{ msg: "signup_counted", n: 2, cap: 3 }])]);
});

// Mutation: replace the single UpdateItem with a GetItem then a PutItem, or
// drop the condition, and two sign-ups racing the last slot both get in.
test("counts with one atomic conditional UpdateItem keyed by UTC month", async () => {
  const f = fake(() => counted(1));
  await make(f.client)(event());
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].constructor.name, "UpdateItemCommand");
  assert.deepEqual(f.sent[0].input, {
    TableName: "tbl",
    Key: { month: { S: "2026-11" } },
    UpdateExpression: "ADD #n :one",
    ConditionExpression: "attribute_not_exists(#n) OR #n < :cap",
    ExpressionAttributeNames: { "#n": "n" },
    ExpressionAttributeValues: { ":one": { N: "1" }, ":cap": { N: "3" } },
    ReturnValues: "UPDATED_NEW",
  });
});

// Mutation: change the thrown text, or let the error through unrecognised
// (fail open on ConditionalCheckFailedException): the cap stops holding.
test("at the cap: refuses with the fixed sentence", async () => {
  const f = fake(capReached);
  await assert.rejects(make(f.client)(event()), { message: CAP_MESSAGE });
});

// Mutation: drop the remembered refusal (or its month) and every refused
// sign-up in a flood calls DynamoDB.
test("remembers the cap for 5 minutes without calling DynamoDB, then asks again", async () => {
  const f = fake(capReached);
  const h = make(f.client);
  await assert.rejects(h(event()), { message: CAP_MESSAGE });
  t += 4 * 60 * 1000;
  await assert.rejects(h(event()), { message: CAP_MESSAGE });
  assert.equal(f.sent.length, 1);
  t += 61 * 1000;
  await assert.rejects(h(event()), { message: CAP_MESSAGE });
  assert.equal(f.sent.length, 2);
});

// Mutation: drop the month from the remembered refusal and the 1st of the
// month stays closed for up to 5 minutes.
test("a new month ignores last month's remembered refusal", async () => {
  const f = fake((call) => (call === 1 ? capReached() : counted(1)));
  const h = make(f.client);
  t = Date.UTC(2026, 10, 30, 23, 59);
  await assert.rejects(h(event()), { message: CAP_MESSAGE });
  t = Date.UTC(2026, 11, 1, 0, 1);
  await h(event());
  assert.equal(f.sent.length, 2);
});

// Mutation: count PreSignUp_AdminCreateUser too and an administrator letting
// someone in is refused at the cap.
test("an administrator's AdminCreateUser passes uncounted", async () => {
  const f = fake(capReached);
  const e = event("PreSignUp_AdminCreateUser");
  assert.equal(untouched(await make(f.client)(e)), e);
  assert.equal(f.sent.length, 0);
});

test("an external-provider sign-up is counted", async () => {
  const f = fake(() => counted(1));
  untouched(await make(f.client)(event("PreSignUp_ExternalProvider")));
  assert.equal(f.sent.length, 1);
});

// Mutation: rethrow any error: a DynamoDB outage then blocks every sign-up.
test("fails open on any error that is not the cap, logging only its class", async () => {
  const f = fake(() => {
    throw Object.assign(new Error(`throttled for ${SECRET}`), {
      name: "ProvisionedThroughputExceededException",
    });
  });
  const e = event();
  assert.equal(untouched(await make(f.client)(e)), e);
  assert.deepEqual(logged, [
    JSON.stringify([
      { msg: "signup_counter_unavailable", error: "ProvisionedThroughputExceededException" },
    ]),
  ]);
});

test("fails open when its configuration is missing", async () => {
  const f = fake(() => counted(1));
  const bad = [
    { table: undefined, cap: 3 },
    { table: "t", cap: NaN },
    // A cap of 0 would refuse everyone after the first: misconfigured, not closed.
    { table: "t", cap: 0 },
  ];
  for (const { table, cap } of bad) {
    const e = event();
    const out = await makeHandler({ client: f.client, table, cap, now })(e);
    assert.equal(untouched(out), e);
  }
  assert.equal(f.sent.length, 0);
});

// Mutation: drop the deadline race in src/index.ts and a DynamoDB call that
// never answers outlives Cognito's 5 seconds, which fails the sign-up.
test("fails open when DynamoDB never answers", { timeout: 2000 }, async () => {
  const hung = { send: () => new Promise(() => undefined) } as never;
  const e = event();
  const h = makeHandler({ client: hung, table: "tbl", cap: 3, now, deadlineMs: 20 });
  assert.equal(untouched(await h(e)), e);
  assert.deepEqual(logged, [
    JSON.stringify([{ msg: "signup_counter_unavailable", error: "DeadlineExceeded" }]),
  ]);
});

// Mutation: console.log(event) (or the username, an attribute, or an error's
// message) anywhere in src/index.ts, including the uncounted-source and
// remembered-refusal branches.
test("logs nothing of the person on any path", async () => {
  const paths = [fake(() => counted(1)), fake(capReached), fake(() => { throw new Error(SECRET); })];
  for (const f of paths) {
    await make(f.client)(event()).catch(() => undefined);
  }
  const capped = make(fake(capReached).client);
  await capped(event()).catch(() => undefined);
  await capped(event()).catch(() => undefined); // the remembered refusal
  await make(fake(capReached).client)(event("PreSignUp_AdminCreateUser"));
  assert.ok(logged.length > 0);
  for (const line of logged) {
    assert.ok(!line.includes("example.test"), line);
    assert.ok(!line.includes("Private"), line);
  }
});

// Mutation: drop throwOnRequestTimeout (the SDK then only warns when a request
// passes requestTimeout), or raise the deadline past what Cognito's 5 seconds
// leaves room for.
test("bounds its DynamoDB call well inside Cognito's 5 seconds", () => {
  const { maxAttempts, requestHandler } = clientConfig;
  assert.equal(maxAttempts, 2);
  assert.equal(requestHandler.throwOnRequestTimeout, true);
  assert.ok(DEADLINE_MS <= 3000);
});
