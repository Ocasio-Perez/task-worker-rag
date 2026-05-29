import "dotenv/config";

import path from "node:path";
import { getCodeMemoryStatus } from "../services/code-memory/status.js";

const TASK_WORKER_URL = process.env.TASK_WORKER_URL || "http://127.0.0.1:9000";

async function main() {
  const result = await getCodeMemoryStatus({
    repoName: process.env.REPO_NAME || process.argv[2] || "",
    taskWorkerUrl: TASK_WORKER_URL,
  });

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printHuman(result);
  }

  process.exit(result.ok ? 0 : 1);
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
