# Node + Express Code Memory Starter

This starter adds local codebase memory to an existing Node/Express task-worker using Ollama for embeddings and ChromaDB for vector storage.

## What it includes

- A repo indexer that scans source files, chunks them, generates embeddings with Ollama, and stores them in ChromaDB.
- A search module that embeds a query and retrieves the nearest code chunks from ChromaDB.
- An Express route at `/api/search-codebase` that exposes code search over HTTP for agents such as Hermes or OpenClaw.
- An example `task-worker.js` showing how to wire the route into an Express app using `express.json()`.

## Project layout

```text
code-memory-starter/
├── .env.example
├── package.json
├── task-worker.js
├── routes/
│   └── search-codebase.js
├── scripts/
│   └── reindex-codebase.js
└── services/
    └── code-memory/
        ├── config.js
        ├── indexer.js
        └── search.js
```

## Requirements

- Node.js 22 or newer for a modern ESM-based runtime.
- A local Ollama server running and reachable over HTTP.
- The `nomic-embed-text` model pulled into Ollama for embeddings.
- A running ChromaDB instance with persistence enabled if you want data to survive restarts.

## Quick start

1. Pull the embedding model:

```bash
ollama pull nomic-embed-text
```

2. Start ChromaDB:

```bash
docker run -d \
  --name chroma \
  -p 8000:8000 \
  -v chroma_data:/chroma/chroma \
  -e IS_PERSISTENT=TRUE \
  -e ANONYMIZED_TELEMETRY=false \
  chromadb/chroma:latest
```

3. Copy the environment file and adjust paths as needed:

```bash
cp .env.example .env
```

4. Install dependencies:

```bash
npm install
```

5. Index your repository:

```bash
npm run index-codebase
```

6. Start the Express app:

```bash
npm start
```

## Environment variables

| Variable | Purpose |
|---|---|
| `CODE_REPO_PATH` | Absolute path to the repository you want to index. |
| `CHROMA_URL` | URL for the running ChromaDB instance. |
| `CHROMA_COLLECTION` | Collection name used for stored chunks. |
| `OLLAMA_HOST` | Base URL for the local Ollama server. |
| `OLLAMA_EMBED_MODEL` | Embedding model name, default `nomic-embed-text`. |
| `CODE_CHUNK_SIZE` | Approximate character length per chunk. |
| `CODE_CHUNK_OVERLAP` | Overlap between adjacent chunks. |
| `CODE_SEARCH_RESULTS` | Default number of retrieved results. |
| `HOST` | Express bind host. |
| `PORT` | Express bind port. |

## API example

Query the search route with JSON:

```bash
curl -X POST http://127.0.0.1:9000/api/search-codebase \
  -H "Content-Type: application/json" \
  -d '{"query":"Where is HMAC validation implemented?","n_results":5}'
```

The route expects a string `query` and returns matching chunks with file metadata and distance values.

## How it works

The indexer walks the repo, skips common junk directories such as `.git` and `node_modules`, and only indexes a defined set of file extensions.
Chunks are embedded through Ollama, then upserted into Chroma under stable IDs derived from relative file path plus chunk number.
At query time, the search service embeds the user query and asks Chroma for nearest neighbors, which are returned to the caller through Express.

## Recommended next improvements

- Add HMAC or internal auth to `/api/search-codebase` so only trusted agents can call it.
- Improve chunking by splitting on functions, classes, or route boundaries instead of fixed character windows.
- Add metadata such as service name, repo name, or language for better filtering.
- Trigger reindexing from a Git hook, webhook, or systemd timer after repository changes.
- Reuse the search service inside your existing Hermes-to-OpenClaw task delegation flow so repo-specific tasks search first before planning or editing.

## Notes

This starter is intentionally minimal so it can live inside one repo and one Express runtime, which is usually the cleanest fit when code memory is a capability of an existing task-worker rather than a separate platform service.
