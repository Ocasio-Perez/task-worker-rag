import crypto from "crypto";

export async function callCodeSearch({ query, nResults = 5 }) {
  const url =
    process.env.CODE_SEARCH_URL ||
    "http://127.0.0.1:9000/api/search-codebase";

  const secret = process.env.CODE_SEARCH_HMAC_SECRET || "";

  const body = JSON.stringify({
    query,
    n_results: nResults,
  });

  const headers = {
    "content-type": "application/json",
  };

  if (secret) {
    headers["x-code-search-signature"] = `sha256=${crypto
      .createHmac("sha256", secret)
      .update(body)
      .digest("hex")}`;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Code search failed with status ${response.status}: ${text}`
    );
  }

  return await response.json();
}