import "dotenv/config";

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { cleanRepoName, resolveRepoPath } from "../services/code-memory/config.js";
import { indexCodebase } from "../services/code-memory/indexer.js";

const repoName = cleanRepoName(process.env.REPO_NAME || process.argv[2] || "");

if (!repoName) {
  console.error("Usage: node scripts/sync-and-reindex.js <repo_name>");
  process.exit(2);
}

try {
  const repoPath = resolveRepoPath(repoName);
  const stat = await fs.stat(repoPath).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    throw new Error(`Repository not found: ${repoName}`);
  }

  const gitStat = await fs.stat(`${repoPath}/.git`).catch(() => null);
  if (gitStat) {
    await run("git", ["-C", repoPath, "pull", "--ff-only"]);
  } else {
    console.log(`Skipping git sync; not a git repository: ${repoPath}`);
  }

  const result = await indexCodebase({ repoName, repoPath });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(`Sync and reindex failed: ${error.message}`);
  process.exit(1);
}

async function run(bin, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: "inherit" });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${bin} ${args.join(" ")} exited with ${code}`));
    });
  });
}
