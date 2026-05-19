import { ChromaClient } from 'chromadb';
import ollama from 'ollama';
import { CODE_MEMORY_CONFIG as config } from './config.js';

ollama.host = config.ollamaHost;

async function getCollection() {
  const client = new ChromaClient({ path: config.chromaUrl });
  return client.getCollection({ name: config.collectionName });
}

async function embedQuery(query) {
  const response = await ollama.embed({
    model: config.embeddingModel,
    input: query,
  });
  return response.embeddings[0];
}

export async function searchCodebase(query, nResults = config.maxResults) {
  const collection = await getCollection();
  const queryEmbedding = await embedQuery(query);

  const results = await collection.query({
    queryEmbeddings: [queryEmbedding],
    nResults,
  });

  const documents = results.documents?.[0] || [];
  const metadatas = results.metadatas?.[0] || [];
  const distances = results.distances?.[0] || [];

  return documents.map((document, i) => ({
    file: metadatas[i]?.file || null,
    fullPath: metadatas[i]?.fullPath || null,
    chunk: metadatas[i]?.chunk ?? null,
    distance: distances[i] ?? null,
    content: document,
  }));
}
