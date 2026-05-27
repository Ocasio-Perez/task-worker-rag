import crypto from "crypto";

export function createHmacSignature(body, secret, { prefix = "sha256=" } = {}) {
  const digest = crypto.createHmac("sha256", secret).update(body).digest("hex");
  return `${prefix}${digest}`;
}

export function hasValidHmacSignature({
  rawBody,
  secret,
  signatureHeader,
  prefix = "sha256=",
} = {}) {
  if (!secret) {
    return true;
  }

  if (!rawBody || !signatureHeader) {
    return false;
  }

  const expected = createHmacSignature(rawBody, secret, { prefix });
  const expectedBuf = Buffer.from(expected, "utf8");
  const actualBuf = Buffer.from(signatureHeader, "utf8");

  return (
    expectedBuf.length === actualBuf.length &&
    crypto.timingSafeEqual(expectedBuf, actualBuf)
  );
}
