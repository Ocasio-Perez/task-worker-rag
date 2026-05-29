import "dotenv/config";

import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { ChromaClient } from "chromadb";
import { CODE_MEMORY_CONFIG as config, cleanRepoName, resolveRepoPath } from "../services/code-memory/config.js";

const TASK_WORKER_URL = process.env.TASK_WORKER_URL || "http://127.0.0.1:9000";

async function main() {
  const repoName = cleanRepoName(process.env.REPO_NAME || process.argv[2] || "");
  const checks = [];

  checks.push(await checkTaskWorker());
  checks.push(await checkOllama());
  checks.push(await checkChroma());
  checks.push(await checkRepoRoot());

  if (repoName) {
    checks.push(await checkRepo(repoName));
    checks.push(await checkRepoGit(repoName));
    checks.push(await checkRepoIndex(repoName));
  }

  const ok = checks.every((check) => check.ok);
  const result = {
    ok,
    checked_at: new Date().toISOString(),
    repo_name: repoName || null,
    config: {
      repo_root: config.repoRoot,
      chroma_url: config.chromaUrl,
      chroma_collection: config.collectionName,
      ollama_host: config.ollamaHost,
      ollama_embed_model: config.embeddingModel,
      task_worker_url: TASK_WORKER_URL,
    },
    checks,
  };

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printHuman(result);
  }

  process.exit(ok ? 0 : 1);
}

async function checkTaskWorker() {
  try {
    const response = await fetch(`${TASK_WORKER_URL}/health`, { signal: AbortSignal.timeout(5000) });
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
    const gitStat = await fs.stat(path.join(repoPath, ".git")).catch(() => null);
    if (!gitStat) {
      return pass("repo-git", "not a git repo");
    }

    const branch = (await runCapture("git", ["-C", repoPath, "branch", "--show-current"])).trim();
    const status = (await runCapture("git", ["-C", repoPath, "status", "--short"])).trim();
    const detail = `${branch || "<detached>"}; working tree ${status ? "dirty" : "clean"}`;
    return pass("repo-git", detail);
  } catch (error) {
    return fail("repo-git", error.message);
  }
}

async function checkRepoIndex(repoName) {
  try {
    const client = new ChromaClient({ path: config.chromaUrl });
    const collection = await client.getCollection({ name: config.collectionName });
    const count = await countRepoChunks(collection, repoName);
    if (count < 1) {
      return fail("repo-index", `no chunks found for repoName=${repoName}`);
    }
    return pass("repo-index", `${count} chunk(s) indexed for ${repoName}`);
  } catch (error) {
    return fail("repo-index", error.message);
  }
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

function pass(name, detail) {
  return { name, ok: true, detail };
}

function fail(name, detail) {
  return { name, ok: false, detail };
}

function printHuman(result) {
  console.log(`Code memory status (${result.checked_at})`);
  console.log("");
  for (const check of result.checks) {
    console.log(`${check.ok ? "OK  " : "FAIL"} ${check.name}: ${check.detail}`);
  }
  console.log("");
  console.log(`repo_root: ${result.config.repo_root}`);
  console.log(`chroma: ${path.basename(result.config.chroma_collection)} @ ${result.config.chroma_url}`);
  console.log(`ollama: ${result.config.ollama_embed_model} @ ${result.config.ollama_host}`);
  console.log(`task-worker: ${result.config.task_worker_url}`);
}

main().catch((error) => {
  console.error("Code memory status failed:", error);
  process.exit(1);
});
