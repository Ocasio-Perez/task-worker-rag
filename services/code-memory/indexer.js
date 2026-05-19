import fs from 'fs/promises';
import path from 'path';
import { ChromaClient } from 'chromadb';
import ollama from 'ollama';
import { CODE_MEMORY_CONFIG as config } from './config.js';

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

async function getCollection() {
  const client = new ChromaClient({ path: config.chromaUrl });
  return client.getOrCreateCollection({
    name: config.collectionName,
    metadata: { source: 'local-codebase', repoPath: config.repoPath },
  });
}

async function indexFile(collection, filePath) {
  const content = await fs.readFile(filePath, 'utf8').catch(() => null);
  if (!content || !content.trim()) return { filePath, chunks: 0 };

  const relativePath = path.relative(config.repoPath, filePath);
  const chunks = chunkText(content);
  if (!chunks.length) return { filePath, chunks: 0 };

  const embeddings = await createEmbeddings(chunks);

  await collection.upsert({
    ids: chunks.map((_, i) => `${relativePath}::${i}`),
    documents: chunks,
    embeddings,
    metadatas: chunks.map((_, i) => ({
      file: relativePath,
      fullPath: filePath,
      chunk: i,
      language: path.extname(filePath).slice(1) || 'text',
    })),
  });

  return { filePath: relativePath, chunks: chunks.length };
}

async function main() {
  const collection = await getCollection();
  const files = await walkRepo(config.repoPath);

  let indexedFiles = 0;
  let indexedChunks = 0;

  for (const file of files) {
    const result = await indexFile(collection, file);
    if (result.chunks > 0) {
      indexedFiles += 1;
      indexedChunks += result.chunks;
      console.log(`Indexed ${result.filePath} (${result.chunks} chunks)`);
    }
  }

  console.log(JSON.stringify({
    success: true,
    repoPath: config.repoPath,
    indexedFiles,
    indexedChunks,
    collection: config.collectionName,
  }, null, 2));
}

main().catch((error) => {
  console.error('Indexing failed:', error);
  process.exit(1);
});
