import test from "node:test";
import assert from "node:assert/strict";
import {
  createHmacSignature,
  hasValidHmacSignature,
} from "../services/security/hmac.js";

test("createHmacSignature returns sha256-prefixed digest", () => {
  const signature = createHmacSignature('{"ok":true}', "secret");
  assert.match(signature, /^sha256=[a-f0-9]{64}$/);
});

test("hasValidHmacSignature accepts matching raw body signature", () => {
  const rawBody = Buffer.from('{"repo_name":"hello-world"}');
  const signatureHeader = createHmacSignature(rawBody, "secret");

  assert.equal(
    hasValidHmacSignature({
      rawBody,
      secret: "secret",
      signatureHeader,
    }),
    true
  );
});

test("hasValidHmacSignature rejects bad signatures", () => {
  assert.equal(
    hasValidHmacSignature({
      rawBody: Buffer.from("{}"),
      secret: "secret",
      signatureHeader: "sha256=bad",
    }),
    false
  );
});

test("hasValidHmacSignature is disabled when secret is empty", () => {
  assert.equal(
    hasValidHmacSignature({
      rawBody: null,
      secret: "",
      signatureHeader: "",
    }),
    true
  );
});
