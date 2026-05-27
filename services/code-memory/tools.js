import fs from "fs/promises";
import path from "path";
import {
  CODE_MEMORY_CONFIG as config,
  cleanRepoName,
  resolveRepoPath,
} from "./config.js";
import { searchCodebase as runCodeSearch } from "./search.js";

const DEFAULT_MAX_BYTES = 50_000;
const MAX_SEARCH_RESULTS = 25;
const PREVIEW_MAX_LENGTH = 220;

function createToolError(message, code, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function buildPreview(content, maxLength = PREVIEW_MAX_LENGTH) {
  if (!content || typeof content !== "string") return "";

  const normalized = content
    .replace(/\r\n/g, "\n")
    .replace(/\t/g, "  ")
    .split("\n")
    .slice(0, 8)
    .join("\n")
    .trim();

  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength).trimEnd()}...`;
}

async function resolveExistingRepo(repoNameInput) {
  const repoName = cleanRepoName(repoNameInput);
  if (!repoName) {
    throw createToolError(
      "repo_name is required and must be a string",
      "missing_repo_name",
      400
    );
  }

  let repoPath;
  try {
    repoPath = resolveRepoPath(repoName);
  } catch (error) {
    throw createToolError(error.message, "invalid_repo_name", 400);
  }

  const stat = await fs.stat(repoPath).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    throw createToolError(`Repository not found: ${repoName}`, "repo_not_found", 404);
  }

  const repoRealPath = await fs.realpath(repoPath);

  return { repoName, repoPath, repoRealPath };
}

function assertRelativePath(value) {
  if (!value || typeof value !== "string") {
    throw createToolError(
      "relative_path is required and must be a string",
      "missing_relative_path",
      400
    );
  }

  if (value.includes("\0")) {
    throw createToolError("relative_path is invalid", "invalid_relative_path", 400);
  }
}

function resolveRepoFilePath(repoPath, relativePath) {
  const candidate = path.resolve(repoPath, relativePath);

  if (!candidate.startsWith(`${repoPath}${path.sep}`)) {
    throw createToolError("relative_path escapes repo", "path_escape", 403);
  }

  return candidate;
}

function assertAllowedExtension(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!config.includeExtensions.has(ext)) {
    throw createToolError("file extension not allowed", "extension_not_allowed", 415);
  }
}

function assertAllowedPath(relativePath) {
  const normalized = relativePath.split(path.sep);
  if (normalized.some((part) => config.ignoreDirs.has(part))) {
    throw createToolError("directory is ignored", "directory_ignored", 415);
  }

  if (config.ignoreFiles.has(path.basename(relativePath))) {
    throw createToolError("file is ignored", "file_ignored", 415);
  }
}

function assertRealPathInsideRepo(fileRealPath, repoRealPath) {
  if (!fileRealPath.startsWith(`${repoRealPath}${path.sep}`)) {
    throw createToolError("relative_path escapes repo", "path_escape", 403);
  }
}

export async function searchCodebaseTool({
  query,
  repo_name,
  n_results,
  include_content = false,
} = {}) {
  if (!query || typeof query !== "string") {
    throw createToolError("query is required and must be a string", "missing_query", 400);
  }

  const { repoName, repoPath } = await resolveExistingRepo(repo_name);
  const nResults = clampNumber(n_results, 1, MAX_SEARCH_RESULTS, config.maxResults);

  const rawResults = await runCodeSearch({
    query,
    repoPath,
    repoName,
    nResults,
  });

  const results = rawResults.slice(0, nResults).map((item) => ({
    file: item.file,
    fullPath: item.fullPath,
    chunk: item.chunk,
    distance: item.distance,
    preview: buildPreview(item.content),
    ...(include_content ? { content: item.content } : {}),
    repoName: item.repoName || repoName,
    repoPath: item.repoPath || repoPath,
  }));

  const files = new Set(results.map((result) => result.file).filter(Boolean));
  const summary = results.length
    ? `Found ${results.length} matching chunks in ${files.size} file${files.size === 1 ? "" : "s"}`
    : "No matching chunks found";

  return {
    success: true,
    ok: true,
    query,
    repo_name: repoName,
    repo_path: repoPath,
    count: results.length,
    summary,
    results,
  };
}

export async function readFileTool({
  repo_name,
  relative_path,
  max_bytes = DEFAULT_MAX_BYTES,
} = {}) {
  assertRelativePath(relative_path);

  const { repoName, repoPath, repoRealPath } = await resolveExistingRepo(repo_name);
  const filePath = resolveRepoFilePath(repoPath, relative_path);
  const normalizedRelativePath = path.relative(repoPath, filePath);
  assertAllowedPath(normalizedRelativePath);
  assertAllowedExtension(filePath);

  let stat;
  let fileRealPath;
  try {
    stat = await fs.stat(filePath);
    fileRealPath = await fs.realpath(filePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw createToolError("file not found", "not_found", 404);
    }
    throw error;
  }

  if (!stat.isFile()) {
    throw createToolError("path is not a regular file", "not_a_file", 400);
  }

  assertRealPathInsideRepo(fileRealPath, repoRealPath);

  const cap = clampNumber(max_bytes, 1, DEFAULT_MAX_BYTES, DEFAULT_MAX_BYTES);
  const bytes = Math.min(stat.size, cap);
  const handle = await fs.open(filePath, "r");

  try {
    const buffer = Buffer.alloc(bytes);
    await handle.read(buffer, 0, bytes, 0);

    return {
      success: true,
      ok: true,
      repo_name: repoName,
      repo_path: repoPath,
      relative_path: normalizedRelativePath,
      bytes,
      total_bytes: stat.size,
      truncated: stat.size > cap,
      content: buffer.toString("utf8"),
    };
  } finally {
    await handle.close();
  }
}
