import express from "express";
import fs from "fs/promises";
import { searchCodebase } from "../services/code-memory/search.js";
import { cleanRepoName, resolveRepoPath } from "../services/code-memory/config.js";
import { hasValidHmacSignature } from "../services/security/hmac.js";

const router = express.Router();
const MAX_SEARCH_RESULTS = 25;

function buildPreview(content, maxLength = 220) {
  if (!content || typeof content !== "string") return "";

  const normalized = content
    .replace(/\r\n/g, "\n")
    .replace(/\t/g, "  ")
    .split("\n")
    .slice(0, 8) // first ~8 lines
    .join("\n")
    .trim();

  if (normalized.length <= maxLength) return normalized;

  return normalized.slice(0, maxLength).trimEnd() + "…";
}

function normalizeResultLimit(value) {
  const requested = Number(value);
  if (!Number.isInteger(requested) || requested <= 0) return undefined;
  return Math.min(requested, MAX_SEARCH_RESULTS);
}

router.post("/search-codebase", async (req, res) => {
  try {
    if (
      !hasValidHmacSignature({
        rawBody: req.rawBody,
        secret: process.env.CODE_SEARCH_HMAC_SECRET || "",
        signatureHeader: req.get("x-code-search-signature"),
      })
    ) {
      return res.status(401).json({
        success: false,
        error: "bad_signature",
        detail: "Invalid code-search signature.",
      });
    }

    const { query, repo_name, n_results, include_content } = req.body || {};

    if (!query || typeof query !== "string") {
      return res.status(400).json({
        success: false,
        error: "query is required and must be a string",
      });
    }

    const requestedRepoName = cleanRepoName(repo_name);

    if (!requestedRepoName) {
      return res.status(400).json({
        success: false,
        error: "repo_name is required and must be a string",
        needs_input: true,
        prompt: "Which repo in ~/.hermes/repos should I use?",
      });
    }

    const repoPath = resolveRepoPath(requestedRepoName);

    const stat = await fs.stat(repoPath).catch(() => null);
    if (!stat || !stat.isDirectory()) {
      return res.status(404).json({
        success: false,
        error: "repo_not_found",
        detail: `Repository not found: ${requestedRepoName}`,
      });
    }

    const nResults = normalizeResultLimit(n_results);

    const rawResults = await searchCodebase({
      query,
      repoPath,
      repoName: requestedRepoName,
      nResults,
    });

    const limited = rawResults.slice(0, nResults ?? rawResults.length);

    const results = limited.map((item) => ({
      file: item.file,
      fullPath: item.fullPath,
      chunk: item.chunk,
      distance: item.distance,
      preview: buildPreview(item.content),
      ...(include_content ? { content: item.content } : {}),
      repoName: item.repoName || requestedRepoName,
      repoPath: item.repoPath || repoPath,
    }));

    const files = new Set(results.map((r) => r.file).filter(Boolean));
    const summary = results.length
      ? `Found ${results.length} matching chunks in ${files.size} file${files.size === 1 ? "" : "s"}`
      : "No matching chunks found";

    return res.json({
      success: true,
      query,
      repo_name: requestedRepoName,
      repo_path: repoPath,
      count: results.length,
      summary,
      results,
    });
  } catch (error) {
    console.error("search-codebase error:", error);
    return res.status(500).json({
      success: false,
      error: "codebase search failed",
      detail: error.message,
    });
  }
});

export default router;
