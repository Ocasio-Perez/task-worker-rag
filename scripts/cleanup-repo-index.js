import "dotenv/config";
import { ChromaClient } from "chromadb";
import { CODE_MEMORY_CONFIG as config, cleanRepoName } from "../services/code-memory/config.js";

async function main() {
  const rawName = process.env.REPO_NAME || process.argv[2] || "";
  const repoName = cleanRepoName(rawName);

  if (!repoName) {
    throw new Error("Provide repo name via REPO_NAME or first CLI arg");
  }

  const client = new ChromaClient({ path: config.chromaUrl });
  const collection = await client.getCollection({ name: config.collectionName });

  console.log(`Deleting embeddings for repoName="${repoName}" from collection "${config.collectionName}"...`);

  await collection.delete({
    where: { repoName },
  });

  console.log(JSON.stringify({
    success: true,
    deletedRepoName: repoName,
    collection: config.collectionName,
  }, null, 2));
}

main().catch((error) => {
  console.error("Cleanup failed:", error);
  process.exit(1);
});