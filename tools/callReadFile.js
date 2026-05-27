import crypto from "node:crypto";
import { createHmacSignature } from "../services/security/hmac.js";

export async function callReadFile({
  repoName = process.env.REPO_NAME || process.env.CODE_REPO_NAME || "",
  relativePath,
  maxBytes = 50_000,
  requestId = crypto.randomUUID(),
  timeoutMs = 15000,
}) {
  if (!repoName) {
    throw new Error("repoName is required");
  }

  if (!relativePath) {
    throw new Error("relativePath is required");
  }

  const url =
    process.env.CODE_READ_FILE_URL ||
    "http://127.0.0.1:9000/api/read-file";

  const secret = process.env.CODE_SEARCH_HMAC_SECRET || "";

  const body = JSON.stringify({
    repo_name: repoName,
    relative_path: relativePath,
    max_bytes: maxBytes,
  });

  const headers = {
    "content-type": "application/json",
    "x-request-id": requestId,
  };

  if (secret) {
    headers["x-code-search-signature"] = createHmacSignature(body, secret);
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Read file failed with status ${response.status}: ${text}`
    );
  }

  const data = await response.json();

  return {
    success: Boolean(data?.success),
    repoName: data?.repo_name ?? repoName,
    relativePath: data?.relative_path ?? relativePath,
    content: data?.content ?? "",
    truncated: Boolean(data?.truncated),
    bytes: Number(data?.bytes ?? 0),
    totalBytes: Number(data?.total_bytes ?? 0),
    requestId,
    raw: data,
  };
}
