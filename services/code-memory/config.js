export const CODE_MEMORY_CONFIG = {
  repoPath: process.env.CODE_REPO_PATH || '/opt/Task-Worker',
  chromaUrl: process.env.CHROMA_URL || 'http://localhost:8000',
  collectionName: process.env.CHROMA_COLLECTION || 'codebase',
  ollamaHost: process.env.OLLAMA_HOST || 'http://127.0.0.1:11434',
  embeddingModel: process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text',
  chunkSize: Number(process.env.CODE_CHUNK_SIZE || 1800),
  chunkOverlap: Number(process.env.CODE_CHUNK_OVERLAP || 200),
  maxResults: Number(process.env.CODE_SEARCH_RESULTS || 5),
  includeExtensions: new Set(['.js', '.ts', '.py', '.json', '.md', '.yaml', '.yml', '.sh']),
  ignoreDirs: new Set(['.git', 'node_modules', 'dist', 'build', '.next', 'coverage', '__pycache__']),
};
