import "dotenv/config";
import { indexCodebase } from "../services/code-memory/indexer.js";

async function main() {
  const repoName = process.env.REPO_NAME || process.argv[2] || "";

  if (!repoName) {
    throw new Error("Provide repo name via REPO_NAME or first CLI arg");
  }

  const result = await indexCodebase({ repoName });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error("Reindex failed:", error);
  process.exit(1);
});