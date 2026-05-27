import crypto from "node:crypto";
import { createHmacSignature } from "../services/security/hmac.js";

export async function callCodeSearch({
  query,
  repoName = process.env.REPO_NAME || process.env.CODE_REPO_NAME || "",
  nResults = 5,
  includeContent = false,
  requestId = crypto.randomUUID(),
  timeoutMs = 15000,
}) {
  if (!repoName) {
    throw new Error("repoName is required");
  }

  const url =
    process.env.CODE_SEARCH_URL ||
    "http://127.0.0.1:9000/api/search-codebase";

  const secret = process.env.CODE_SEARCH_HMAC_SECRET || "";

  const body = JSON.stringify({
    query,
    repo_name: repoName,
    n_results: nResults,
    ...(includeContent ? { include_content: true } : {}),
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
      `Code search failed with status ${response.status}: ${text}`
    );
  }

  const data = await response.json();

  return {
    success: Boolean(data?.success),
    query: data?.query ?? query,
    count: Number(data?.count ?? 0),
    results: Array.isArray(data?.results) ? data.results : [],
    requestId,
    raw: data,
  };
}
