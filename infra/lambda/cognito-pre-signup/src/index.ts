/**
 * Cognito pre sign-up Lambda: a hard cap on accounts created per calendar
 * month, so the user pool's bill has a ceiling (Cognito bills a user active
 * for the month they sign up, confirmed or not).
 *
 * One atomic DynamoDB UpdateItem counts and checks together. At the cap the
 * sign-up is refused with CAP_MESSAGE; any other failure lets the sign-up
 * through uncounted, because a Lambda that errors fails real people's sign-ups.
 *
 * Privacy: the event carries the person's email and attributes. Nothing from
 * it is logged, and errors are logged by class only. Guard: index.test.ts.
 */
import { DynamoDBClient, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import type { PreSignUpTriggerEvent } from "aws-lambda";

// Both clients match on this sentence inside Cognito's
// "PreSignUp failed with error <text>" (shared/src/apiErrors.ts). Guard:
// shared/src/signupCap.test.ts reads this line.
export const CAP_MESSAGE = "Logjam is not taking new accounts this month";

// Cognito gives a trigger 5 seconds in all and may retry it. Two attempts of
// at most 1 second each leave the handler well inside that.
export const clientConfig = {
  maxAttempts: 2,
  requestHandler: { requestTimeout: 1000, connectionTimeout: 1000 },
};

const COUNTED_SOURCES = new Set(["PreSignUp_SignUp", "PreSignUp_ExternalProvider"]);

// ponytail: while the cap is full, a refused sign-up costs one invocation and
// no DynamoDB call, about US$27 of Lambda at Cognito's 50 sign-ups a second for
// a whole month. If that ever matters, switch the pool to administrator-only
// sign-up when the cap is reached (UpdateUserPool resets every setting it is
// not given, the email sender included, so it needs care).
const REFUSAL_MEMORY_MS = 5 * 60 * 1000;

type Deps = {
  client: Pick<DynamoDBClient, "send">;
  table: string | undefined;
  cap: number;
  now: () => Date;
};

export function makeHandler({ client, table, cap, now }: Deps) {
  let refusedMonth = "";
  let refusedUntil = 0;

  return async (event: PreSignUpTriggerEvent): Promise<PreSignUpTriggerEvent> => {
    if (!COUNTED_SOURCES.has(event.triggerSource)) return event;

    const month = now().toISOString().slice(0, 7);
    if (refusedMonth === month && now().getTime() < refusedUntil) {
      throw new Error(CAP_MESSAGE);
    }

    let n: number;
    try {
      if (!table || !Number.isFinite(cap)) throw new TypeError("misconfigured");
      const out = await client.send(
        new UpdateItemCommand({
          TableName: table,
          Key: { month: { S: month } },
          UpdateExpression: "ADD #n :one",
          ConditionExpression: "attribute_not_exists(#n) OR #n < :cap",
          ExpressionAttributeNames: { "#n": "n" },
          ExpressionAttributeValues: {
            ":one": { N: "1" },
            ":cap": { N: String(cap) },
          },
          ReturnValues: "UPDATED_NEW",
        }),
      );
      n = Number(out.Attributes?.n?.N);
      if (!Number.isFinite(n)) throw new TypeError("no count");
    } catch (err) {
      if (err instanceof Error && err.name === "ConditionalCheckFailedException") {
        refusedMonth = month;
        refusedUntil = now().getTime() + REFUSAL_MEMORY_MS;
        throw new Error(CAP_MESSAGE);
      }
      console.warn({
        msg: "signup_counter_unavailable",
        error: err instanceof Error ? err.name : "unknown",
      });
      return event;
    }

    console.log({ msg: "signup_counted", n, cap });
    return event;
  };
}

export const handler = makeHandler({
  client: new DynamoDBClient(clientConfig),
  table: process.env.TABLE_NAME,
  cap: Number(process.env.SIGNUP_CAP),
  now: () => new Date(),
});
