import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { ChromaClient } from "chromadb";
import {
  CODE_MEMORY_CONFIG as config,
  cleanRepoName,
  resolveRepoPath,
} from "./config.js";

export async function getCodeMemoryStatus({
  repoName = "",
  taskWorkerUrl = process.env.TASK_WORKER_URL || "http://127.0.0.1:9000",
} = {}) {
  const cleanedRepoName = cleanRepoName(repoName);
  const checks = [];

  checks.push(await checkTaskWorker(taskWorkerUrl));
  checks.push(await checkOllama());
  checks.push(await checkChroma());
  checks.push(await checkRepoRoot());

  if (cleanedRepoName) {
    checks.push(await checkRepo(cleanedRepoName));
    checks.push(await checkRepoGit(cleanedRepoName));
    checks.push(await checkRepoIndex(cleanedRepoName));
  }

  return {
    ok: checks.every((check) => check.ok),
    checked_at: new Date().toISOString(),
    repo_name: cleanedRepoName || null,
    config: publicConfig(taskWorkerUrl),
    checks,
  };
}

export async function listCodeRepos({ includeIndex = false } = {}) {
  const entries = await fs.readdir(config.repoRoot, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });

  const repos = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const repoName = entry.name;
    const repoPath = path.join(config.repoRoot, repoName);
    const git = await getGitInfo(repoPath);
    const repo = {
      name: repoName,
      path: repoPath,
      git: git.isGit,
      branch: git.branch,
      dirty: git.dirty,
    };

    if (includeIndex) {
      repo.indexed_chunks = await getRepoChunkCount(repoName).catch(() => null);
    }

    repos.push(repo);
  }

  return repos.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getRepoChunkCount(repoName) {
  const client = new ChromaClient({ path: config.chromaUrl });
  const collection = await client.getCollection({ name: config.collectionName });
  return countRepoChunks(collection, repoName);
}

async function checkTaskWorker(taskWorkerUrl) {
  try {
    const response = await fetch(`${taskWorkerUrl}/health`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) {
      return fail("task-worker", `GET /health returned ${response.status}`);
    }
    const body = await response.json().catch(() => ({}));
    return pass("task-worker", `healthy${body.agent ? ` (${body.agent})` : ""}`);
  } catch (error) {
    return fail("task-worker", error.message);
  }
}

async function checkOllama() {
  try {
    const response = await fetch(`${config.ollamaHost}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) {
      return fail("ollama", `GET /api/tags returned ${response.status}`);
    }
    const body = await response.json().catch(() => ({}));
    const models = Array.isArray(body.models) ? body.models.map((model) => model.name) : [];
    const hasEmbedModel = models.some((name) => name === config.embeddingModel);
    return {
      name: "ollama",
      ok: true,
      detail: hasEmbedModel
        ? `reachable; embedding model present (${config.embeddingModel})`
        : `reachable; embedding model not listed (${config.embeddingModel})`,
    };
  } catch (error) {
    return fail("ollama", error.message);
  }
}

async function checkChroma() {
  try {
    const client = new ChromaClient({ path: config.chromaUrl });
    await client.heartbeat();
    return pass("chroma", `reachable at ${config.chromaUrl}`);
  } catch (error) {
    return fail("chroma", error.message);
  }
}

async function checkRepoRoot() {
  const stat = await fs.stat(config.repoRoot).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    return fail("repo-root", `missing directory: ${config.repoRoot}`);
  }
  return pass("repo-root", config.repoRoot);
}

async function checkRepo(repoName) {
  try {
    const repoPath = resolveRepoPath(repoName);
    const stat = await fs.stat(repoPath).catch(() => null);
    if (!stat || !stat.isDirectory()) {
      return fail("repo", `missing directory: ${repoPath}`);
    }
    return pass("repo", repoPath);
  } catch (error) {
    return fail("repo", error.message);
  }
}

async function checkRepoGit(repoName) {
  try {
    const repoPath = resolveRepoPath(repoName);
    const git = await getGitInfo(repoPath);
    if (!git.isGit) {
      return pass("repo-git", "not a git repo");
    }
    return pass("repo-git", `${git.branch || "<detached>"}; working tree ${git.dirty ? "dirty" : "clean"}`);
  } catch (error) {
    return fail("repo-git", error.message);
  }
}

async function checkRepoIndex(repoName) {
  try {
    const count = await getRepoChunkCount(repoName);
    if (count < 1) {
      return fail("repo-index", `no chunks found for repoName=${repoName}`);
    }
    return pass("repo-index", `${count} chunk(s) indexed for ${repoName}`);
  } catch (error) {
    return fail("repo-index", error.message);
  }
}

async function getGitInfo(repoPath) {
  const gitStat = await fs.stat(path.join(repoPath, ".git")).catch(() => null);
  if (!gitStat) {
    return { isGit: false, branch: null, dirty: false };
  }

  const branch = (await runCapture("git", ["-C", repoPath, "branch", "--show-current"])).trim();
  const status = (await runCapture("git", ["-C", repoPath, "status", "--short"])).trim();
  return {
    isGit: true,
    branch: branch || null,
    dirty: Boolean(status),
  };
}

async function runCapture(bin, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `${bin} exited with ${code}`));
    });
  });
}

async function countRepoChunks(collection, repoName) {
  if (typeof collection.count === "function") {
    try {
      return await collection.count({ where: { repoName } });
    } catch {
      // Older Chroma clients do not accept a filtered count.
    }
  }

  const result = await collection.get({
    where: { repoName },
    include: [],
  });
  return Array.isArray(result.ids) ? result.ids.length : 0;
}

function publicConfig(taskWorkerUrl) {
  return {
    repo_root: config.repoRoot,
    chroma_url: config.chromaUrl,
    chroma_collection: config.collectionName,
    ollama_host: config.ollamaHost,
    ollama_embed_model: config.embeddingModel,
    task_worker_url: taskWorkerUrl,
  };
}

function pass(name, detail) {
  return { name, ok: true, detail };
}

function fail(name, detail) {
  return { name, ok: false, detail };
}
