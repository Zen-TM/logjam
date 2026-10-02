// Guards the sign-up/reset-code decrypt path across @aws-crypto/client-node
// upgrades. KMS is not reachable here, so a raw AES keyring stands in; the
// commitment policy and the message format are what is under test.
// Mutation that turns it red: REQUIRE_ENCRYPT_REQUIRE_DECRYPT in src/index.ts.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import {
  buildClient,
  CommitmentPolicy,
  RawAesKeyringNode,
  RawAesWrappingSuiteIdentifier,
} from "@aws-crypto/client-node";
import { decrypt } from "./index.js";

const keyring = new RawAesKeyringNode({
  keyName: "test",
  keyNamespace: "test",
  unencryptedMasterKey: randomBytes(32),
  wrappingSuite:
    RawAesWrappingSuiteIdentifier.AES256_GCM_IV12_TAG16_NO_PADDING,
});

// A message without key commitment, as a Cognito-side encrypt may produce.
test("decrypts a non-committing message", async () => {
  const { encrypt } = buildClient(CommitmentPolicy.FORBID_ENCRYPT_ALLOW_DECRYPT);
  const { result } = await encrypt(keyring, "123456");
  const { plaintext } = await decrypt(keyring, result);
  assert.equal(plaintext.toString("utf-8"), "123456");
});

test("decrypts a committing message", async () => {
  const { encrypt } = buildClient(CommitmentPolicy.REQUIRE_ENCRYPT_REQUIRE_DECRYPT);
  const { result } = await encrypt(keyring, "654321");
  const { plaintext } = await decrypt(keyring, result);
  assert.equal(plaintext.toString("utf-8"), "654321");
});
