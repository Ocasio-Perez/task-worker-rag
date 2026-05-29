import "dotenv/config";

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { CODE_MEMORY_CONFIG as config, cleanRepoName, resolveRepoPath } from "../services/code-memory/config.js";

const command = process.argv[2] || "list";
const repoArg = process.argv[3] || "";

async function main() {
  switch (command) {
    case "add":
      return addRepo(process.argv[3] || "", process.argv[4] || "");
    case "list":
      return printRepos();
    case "show":
      return showRepo(requiredRepoName());
    case "sync":
      return syncRepo(requiredRepoName());
    case "reindex":
      return runNpmScript("index-codebase", requiredRepoName());
    case "cleanup":
      return runNpmScript("cleanup-index", requiredRepoName());
    default:
      throw new Error(`Unknown command: ${command}\nUsage: npm run code-repos -- <add|list|show|sync|reindex|cleanup> [args]`);
  }
}

async function addRepo(gitUrl, requestedName) {
  if (!gitUrl) {
    throw new Error("Usage: npm run code-repos -- add <git_url> [repo_name]");
  }

  const repoName = cleanRepoName(requestedName || repoNameFromGitUrl(gitUrl));
  if (!repoName) {
    throw new Error("Could not infer repo_name; provide one explicitly");
  }

  await fs.mkdir(config.repoRoot, { recursive: true });
  const repoPath = resolveRepoPath(repoName);
  const stat = await fs.stat(repoPath).catch(() => null);
  if (stat) {
    throw new Error(`Repository already exists: ${repoPath}`);
  }

  await runPassthrough("git", ["clone", gitUrl, repoPath]);
  console.log(`Added ${repoName}: ${repoPath}`);
}

async function printRepos() {
  const repos = await listRepos();
  if (!repos.length) {
    console.log(`No repositories found under ${config.repoRoot}`);
    return;
  }

  console.log(`Repositories under ${config.repoRoot}:`);
  for (const repo of repos) {
    console.log(`- ${repo.name}${repo.git ? " (git)" : ""}`);
  }
}

async function showRepo(repoName) {
  const repoPath = resolveRepoPath(repoName);
  const stat = await fs.stat(repoPath).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    throw new Error(`Repository not found: ${repoName}`);
  }

  console.log(`repo_name: ${repoName}`);
  console.log(`path: ${repoPath}`);
  console.log(`git: ${(await isGitRepo(repoPath)) ? "yes" : "no"}`);

  if (await isGitRepo(repoPath)) {
    const branch = await runCapture("git", ["-C", repoPath, "branch", "--show-current"]);
    const status = await runCapture("git", ["-C", repoPath, "status", "--short"]);
    console.log(`branch: ${branch.trim() || "<detached>"}`);
    console.log(`working_tree: ${status.trim() ? "dirty" : "clean"}`);
  }
}

async function syncRepo(repoName) {
  const repoPath = resolveRepoPath(repoName);
  if (!(await isGitRepo(repoPath))) {
    throw new Error(`Repository is not a git repo: ${repoPath}`);
  }

  await runPassthrough("git", ["-C", repoPath, "pull", "--ff-only"]);
}

async function listRepos() {
  const entries = await fs.readdir(config.repoRoot, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });

  const repos = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const repoPath = path.join(config.repoRoot, entry.name);
    repos.push({
      name: entry.name,
      git: await isGitRepo(repoPath),
    });
  }

  return repos.sort((a, b) => a.name.localeCompare(b.name));
}

async function isGitRepo(repoPath) {
  const stat = await fs.stat(path.join(repoPath, ".git")).catch(() => null);
  return Boolean(stat);
}

function requiredRepoName() {
  const repoName = cleanRepoName(repoArg);
  if (!repoName) {
    throw new Error(`repo_name is required for ${command}`);
  }
  return repoName;
}

async function runNpmScript(scriptName, repoName) {
  await runPassthrough("npm", ["run", scriptName, "--", repoName]);
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

async function runPassthrough(bin, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: "inherit" });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${bin} ${args.join(" ")} exited with ${code}`));
    });
  });
}

function repoNameFromGitUrl(gitUrl) {
  const withoutTrailingSlash = String(gitUrl || "").replace(/\/+$/, "");
  const lastSegment = withoutTrailingSlash.split(/[/:]/).pop() || "";
  return lastSegment.replace(/\.git$/i, "");
}

main().catch((error) => {
  console.error(`code-repos failed: ${error.message}`);
  process.exit(1);
});
