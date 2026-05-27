import fs from "fs/promises";
import path from "path";
import { pathToFileURL } from "url";
import { ChromaClient } from "chromadb";
import ollama from "ollama";
import {
  CODE_MEMORY_CONFIG as config,
  cleanRepoName,
  resolveRepoPath,
  getFileKind,
} from "./config.js";

ollama.host = config.ollamaHost;

function chunkText(text, size = config.chunkSize, overlap = config.chunkOverlap) {
  const chunks = [];
  for (let i = 0; i < text.length; i += size - overlap) {
    const chunk = text.slice(i, i + size).trim();
    if (chunk) chunks.push(chunk);
  }
  return chunks;
}

async function walkRepo(dir, files = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (config.ignoreDirs.has(entry.name)) continue;
    if (entry.isFile() && config.ignoreFiles.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      await walkRepo(fullPath, files);
      continue;
    }

    if (config.includeExtensions.has(path.extname(entry.name).toLowerCase())) {
      files.push(fullPath);
    }
  }

  return files;
}

async function createEmbeddings(inputs) {
  const response = await ollama.embed({
    model: config.embeddingModel,
    input: inputs,
  });
  return response.embeddings;
}

async function getCollection(repoName, repoPath) {
  const client = new ChromaClient({ path: config.chromaUrl });
  return client.getOrCreateCollection({
    name: config.collectionName,
    metadata: {
      source: "local-codebase",
      repoName,
      repoPath,
    },
  });
}

async function indexFile(collection, filePath, repoPath, repoName) {
  const content = await fs.readFile(filePath, "utf8").catch(() => null);
  if (!content || !content.trim()) return { filePath, chunks: 0 };

  const relativePath = path.relative(repoPath, filePath);
  const extension = path.extname(filePath).toLowerCase();
  const kind = getFileKind(relativePath);
  const chunks = chunkText(content);
  if (!chunks.length) return { filePath, chunks: 0 };

  const embeddings = await createEmbeddings(chunks);

  await collection.upsert({
    ids: chunks.map((_, i) => `${repoName}::${relativePath}::${i}`),
    documents: chunks,
    embeddings,
    metadatas: chunks.map((_, i) => ({
      repoName,
      repoPath,
      file: relativePath,
      fullPath: filePath,
      chunk: i,
      extension,
      kind,
      language: extension.slice(1) || "text",
    })),
  });

  return { filePath: relativePath, chunks: chunks.length };
}

export async function indexCodebase({ repoName, repoPath } = {}) {
  const cleanedRepoName = cleanRepoName(repoName);
  if (!cleanedRepoName) {
    throw new Error("repoName is required");
  }

  const resolvedRepoPath = repoPath || resolveRepoPath(cleanedRepoName);
  const stat = await fs.stat(resolvedRepoPath).catch(() => null);

  if (!stat || !stat.isDirectory()) {
    throw new Error(`Repository not found: ${cleanedRepoName}`);
  }

  const collection = await getCollection(cleanedRepoName, resolvedRepoPath);
  const files = await walkRepo(resolvedRepoPath);

  let indexedFiles = 0;
  let indexedChunks = 0;

  for (const file of files) {
    const result = await indexFile(collection, file, resolvedRepoPath, cleanedRepoName);
    if (result.chunks > 0) {
      indexedFiles += 1;
      indexedChunks += result.chunks;
      console.log(`Indexed ${cleanedRepoName}:${result.filePath} (${result.chunks} chunks)`);
    }
  }

  return {
    success: true,
    repoName: cleanedRepoName,
    repoPath: resolvedRepoPath,
    indexedFiles,
    indexedChunks,
    collection: config.collectionName,
  };
}

async function main() {
  const repoName = cleanRepoName(process.env.REPO_NAME || process.argv[2] || "");
  if (!repoName) {
    throw new Error("Provide repo name via REPO_NAME or first CLI arg");
  }

  const result = await indexCodebase({ repoName });
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error("Indexing failed:", error);
    process.exit(1);
  });
}
