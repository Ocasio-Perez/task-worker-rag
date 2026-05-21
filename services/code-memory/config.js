import path from "path";

export const CODE_MEMORY_CONFIG = {
  repoRoot: process.env.REPO_ROOT || "/home/larry/.hermes/repos",
  chromaUrl: process.env.CHROMA_URL || "http://localhost:8000",
  collectionName: process.env.CHROMA_COLLECTION || "codebase",
  ollamaHost: process.env.OLLAMA_HOST || "http://127.0.0.1:11434",
  embeddingModel: process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text",
  chunkSize: Number(process.env.CODE_CHUNK_SIZE || 1800),
  chunkOverlap: Number(process.env.CODE_CHUNK_OVERLAP || 200),
  maxResults: Number(process.env.CODE_SEARCH_RESULTS || 5),
  includeExtensions: new Set([
    ".js",
    ".ts",
    ".py",
    ".json",
    ".md",
    ".yaml",
    ".yml",
    ".sh",
  ]),
  ignoreDirs: new Set([
    ".git",
    "node_modules",
    "dist",
    "build",
    ".next",
    "coverage",
    "__pycache__",
  ]),
  ignoreFiles: new Set([
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "bun.lockb",
  ]),
};

export function cleanRepoName(value) {
  const repo = String(value || "").trim();
  if (!repo) return "";
  return repo.replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 120);
}

export function resolveRepoPath(repoName) {
  const cleaned = cleanRepoName(repoName);
  if (!cleaned) {
    throw new Error("repo_name is required");
  }

  const resolved = path.resolve(CODE_MEMORY_CONFIG.repoRoot, cleaned);
  const rootResolved = path.resolve(CODE_MEMORY_CONFIG.repoRoot);

  if (resolved === rootResolved || !resolved.startsWith(`${rootResolved}${path.sep}`)) {
    throw new Error("invalid repo_name");
  }

  return resolved;
}

export function getFileKind(filePath) {
  const normalized = String(filePath || "").toLowerCase();
  const ext = path.extname(normalized);

  if (
    normalized === "readme.md" ||
    normalized.startsWith("docs/") ||
    normalized.includes("/docs/") ||
    ext === ".md"
  ) {
    return "doc";
  }

  if (
    normalized.endsWith("package.json") ||
    normalized.endsWith(".yaml") ||
    normalized.endsWith(".yml") ||
    normalized.endsWith(".json")
  ) {
    return "config";
  }

  if ([".js", ".ts", ".py", ".sh"].includes(ext)) {
    return "code";
  }

  return "other";
}