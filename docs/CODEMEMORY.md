# Code Memory for task-worker-rag

This document describes the code-memory layer now wired into `task-worker-rag` using Ollama for embeddings and ChromaDB for vector storage.

## What is now implemented

The current implementation includes:

- a repository indexer in `services/code-memory/indexer.js`
- a semantic search service in `services/code-memory/search.js`
- a route module in `routes/search-codebase.js`
- a reindex entrypoint in `scripts/reindex-codebase.js`
- route mounting from `task-worker.js` via `app.use("/api", searchCodebaseRouter)`
- HMAC protection for `/api/search-codebase` using `CODE_SEARCH_HMAC_SECRET`

This means code search is no longer just a planned enhancement. It is part of the project structure and should be treated as a first-class internal capability.

## Current layout

```text
task-worker-rag/
├── task-worker.js
├── routes/
│   └── search-codebase.js
├── scripts/
│   └── reindex-codebase.js
└── services/
    ├── code-memory/
    │   ├── config.js
    │   ├── indexer.js
    │   └── search.js
    └── security/
        └── hmac.js
```

## Runtime roles

Each file has a specific responsibility:

- `task-worker.js` starts the Express server and mounts the `/api` router.
- `routes/read-file.js` validates input, verifies HMAC, and returns repo-confined file content over HTTP.
- `routes/search-codebase.js` validates input, verifies HMAC, and returns search results over HTTP.
- `services/code-memory/config.js` centralizes repo path, Chroma, Ollama, chunking, and filtering settings.
- `services/code-memory/indexer.js` walks the repo and writes embeddings into Chroma.
- `services/code-memory/search.js` embeds queries and retrieves nearest chunks.
- `services/code-memory/tools.js` exposes the shared search and read-file contracts used by routes and future in-process tool loops.
- `scripts/reindex-codebase.js` runs the indexer through npm.

## Entry points

The project now has two relevant entrypoints:

- `npm start` -> `node task-worker.js`
- `npm run index-codebase` -> `node scripts/reindex-codebase.js`

`npm start` should always start the server, not the indexer. The indexer is a separate one-shot process.

## Configuration

Code-memory behavior is configured through these environment variables:

| Variable | Purpose |
|---|---|
| `REPO_ROOT` | Root directory that contains repositories addressable by `repo_name`. |
| `REPO_NAME` | Optional default repository name for CLI helpers. |
| `CODE_REPO_NAME` | Optional default repository name for `tools/callCodeSearch.js`. |
| `CHROMA_URL` | URL for the running ChromaDB instance. |
| `CHROMA_COLLECTION` | Collection name used to store code chunks. |
| `OLLAMA_HOST` | Ollama base URL. |
| `OLLAMA_EMBED_MODEL` | Embedding model name, typically `nomic-embed-text`. |
| `CODE_CHUNK_SIZE` | Approximate chunk size in characters. |
| `CODE_CHUNK_OVERLAP` | Character overlap between chunks. |
| `CODE_SEARCH_RESULTS` | Default number of results returned by search. |
| `CODE_SEARCH_HMAC_SECRET` | Shared secret for `/api/search-codebase` request signing; in this setup it can reuse the same local shared HMAC secret already used by the worker flow. |

## Search route

The code-memory search route is:

```text
POST /api/search-codebase
```

Expected request body:

```json
{
  "repo_name": "task-worker-rag",
  "query": "Where is HMAC validation implemented?",
  "n_results": 5
}
```

Expected response shape:

```json
{
  "success": true,
  "query": "Where is HMAC validation implemented?",
  "repo_name": "task-worker-rag",
  "repo_path": "/home/larry/.hermes/repos/task-worker-rag",
  "count": 5,
  "results": [
    {
      "file": "task-worker.js",
      "fullPath": "/absolute/path/to/repo/task-worker.js",
      "chunk": 0,
      "distance": 0.123,
      "preview": "...",
      "repoName": "task-worker-rag",
      "repoPath": "/home/larry/.hermes/repos/task-worker-rag"
    }
  ]
}
```

## Read-file route

The code-memory read-file route is:

```text
POST /api/read-file
```

Expected request body:

```json
{
  "repo_name": "task-worker-rag",
  "relative_path": "task-worker.js",
  "max_bytes": 8000
}
```

Expected response shape:

```json
{
  "success": true,
  "ok": true,
  "repo_name": "task-worker-rag",
  "repo_path": "/home/larry/.hermes/repos/task-worker-rag",
  "relative_path": "task-worker.js",
  "bytes": 8000,
  "total_bytes": 12000,
  "truncated": true,
  "content": "..."
}
```

## HMAC protection

The route now follows the same raw-body HMAC style already used elsewhere in task-worker.

Important details:

- Express captures `req.rawBody` in `task-worker.js` using `express.json({ verify: ... })`
- `/api/search-codebase` verifies the header `x-code-search-signature`
- the signature format is `sha256=<hex digest>`
- the digest is computed over the exact raw request body bytes
- shared helpers in `services/security/hmac.js` use `crypto.timingSafeEqual` for comparison

This keeps `/task`, `/result`, `/api/search-codebase`, `/api/read-file`, and outbound Hermes callback signing on the same HMAC implementation.

## How indexing works

The current indexing flow is:

1. Read `repo_name` from the CLI argument or `REPO_NAME`
2. Resolve it below `REPO_ROOT`
3. Walk the repository recursively
4. Skip ignored directories such as `.git`, `node_modules`, `dist`, and `build`
5. Keep only configured file extensions
6. Chunk file contents
7. Generate embeddings with Ollama
8. Upsert documents, embeddings, and metadata into ChromaDB

Chunk IDs are derived from relative file path plus chunk number so they remain stable across reindexing for unchanged files.

## How search works

The current search flow is:

1. Receive `repo_name`, `query`, and optional `n_results` over HTTP
2. Verify HMAC if `CODE_SEARCH_HMAC_SECRET` is set
3. Resolve and validate the repository path below `REPO_ROOT`
4. Embed the query with the configured Ollama model
5. Query the configured Chroma collection
6. Return ranked matching chunks with file metadata and distance values

This is the retrieval layer that later callers such as Hermes-side helpers can use before planning or delegation.

## Validation commands

Use these commands during development:

### Syntax validation

```bash
npm run check
```

### Reindex repo

```bash
npm run index-codebase -- task-worker-rag
```

### Start server

```bash
npm start
```

### Signed search request

Readable terminal output:

```bash
npm run code-search -- --repo task-worker-rag "Where is HMAC validation implemented?"
```

Use `--content` to include full matching chunks or `--json` to inspect the raw response.

Raw signed request:

```bash
SECRET='<CODE_SEARCH_HMAC_SECRET>'
BODY='{"repo_name":"task-worker-rag","query":"Where is HMAC validation implemented?","n_results":5}'
DIGEST=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | sed 's/^.* //')
SIG="sha256=$DIGEST"

curl -v http://127.0.0.1:9000/api/search-codebase \
  -H "content-type: application/json" \
  -H "x-code-search-signature: $SIG" \
  -d "$BODY"
```

### Signed read-file request

Readable terminal output:

```bash
npm run code-read -- --repo task-worker-rag task-worker.js
```

Raw signed request:

```bash
SECRET='<CODE_SEARCH_HMAC_SECRET>'
BODY='{"repo_name":"task-worker-rag","relative_path":"task-worker.js","max_bytes":8000}'
DIGEST=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | sed 's/^.* //')
SIG="sha256=$DIGEST"

curl -v http://127.0.0.1:9000/api/read-file \
  -H "content-type: application/json" \
  -H "x-code-search-signature: $SIG" \
  -d "$BODY"
```

## Recommended next improvements

The current implementation is a strong first version. The next improvements worth prioritizing are:

- smarter chunking by function, class, or route boundary instead of character windows
- richer metadata such as repo name, service name, or symbol type
- incremental reindexing instead of full reindex passes
- a Git hook, cron job, or systemd timer to keep embeddings fresh

## Scope note

`callCodeSearch` should not be imported by `task-worker.js` itself unless the server is intentionally acting as a client to its own HTTP endpoint.

Inside `task-worker-rag`:

- the route should call local `searchCodebase()` directly
- external callers should use an HTTP helper only if they are outside the server path

That distinction keeps the code-memory layer modular and avoids unnecessary loopback HTTP calls.

## Secret reuse note

For this local setup, `CODE_SEARCH_HMAC_SECRET` can reuse the same shared secret you already use for the trusted worker-to-Hermes path.

That is acceptable because all callers are part of the same local trust boundary and the route is intended for internal use only. If you later expose more callers or split services across different trust domains, give code search its own separate secret.
