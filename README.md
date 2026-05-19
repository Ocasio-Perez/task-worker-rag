Hermes + task-worker + OpenClaw + Code Memory Guide
This guide documents the current wiring for Hermes, task-worker, OpenClaw, and the new local code-memory layer built into task-worker-rag.

The transport layer is HTTP-based:

text
Hermes hook -> task-worker /task -> OpenClaw /v1/chat/completions -> task-worker -> Hermes webhook
The code-memory layer adds a second internal capability:

text
Caller -> task-worker /api/search-codebase -> ChromaDB + Ollama embeddings -> matching code chunks
Topology
The task-worker now plays two roles:

It brokers delegated tasks between Hermes and OpenClaw.

It exposes a signed code-search endpoint backed by Ollama embeddings and ChromaDB.

That keeps orchestration, execution, and repository retrieval in one runtime while still separating routing, indexing, and search logic into dedicated modules.

Working ports and services
The current local endpoints are:

Hermes webhook listener: http://127.0.0.1:8644

task-worker: http://127.0.0.1:9000

OpenClaw gateway: http://127.0.0.1:18789

ChromaDB: http://127.0.0.1:8000

Ollama embeddings host: http://127.0.0.1:11434

OpenClaw is used for delegated execution, while ChromaDB and Ollama support repository indexing and semantic code search.

Current project structure
text
task-worker-rag/
├── CODEMEMORY.md
├── README.md
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
The split is intentional:

task-worker.js is the long-running Express server entrypoint.

routes/search-codebase.js owns the HTTP route for code search.

services/code-memory/indexer.js indexes repo files into Chroma.

services/code-memory/search.js performs semantic retrieval.

scripts/reindex-codebase.js is the one-shot indexing entrypoint.

task-worker server behavior
The task-worker exposes these HTTP endpoints:

POST /task for Hermes delegated work

POST /result for OpenClaw result callbacks if callback mode is used

POST /api/search-codebase for signed semantic repo search

GET / and GET /health for basic service checks

task-worker.js should remain the npm start entrypoint because it creates the Express app, mounts routes, handles HMAC verification for delegated task flow, and starts the listener.

npm scripts
The recommended scripts are:

json
{
  "scripts": {
    "start": "node task-worker.js",
    "dev": "node --watch task-worker.js",
    "index-codebase": "node scripts/reindex-codebase.js",
    "check": "node --check task-worker.js && node --check routes/search-codebase.js && node --check scripts/reindex-codebase.js && node --check services/code-memory/config.js && node --check services/code-memory/indexer.js && node --check services/code-memory/search.js"
  }
}
npm start should start the server. npm run index-codebase should perform a one-time indexing pass over the configured repo.

task-worker environment
The task-worker now needs both transport settings and code-memory settings.

A working shape is:

text
AGENT_NAME=Claw
HOST=127.0.0.1
PORT=9000

HERMES_SECRET=<same value as Hermes TASK_WORKER_SECRET>
OPENCLAW_SECRET=<shared secret for /result verification if OpenClaw signs callbacks>
CODE_SEARCH_HMAC_SECRET=<reuse the same shared HMAC secret already used in your local worker/Hermes setup>

OPENCLAW_URL=http://127.0.0.1:18789/v1/chat/completions
OPENCLAW_API_KEY=<OpenClaw gateway token>

HERMES_WEBHOOK_URL=http://127.0.0.1:8644/webhooks/task-worker-result
HERMES_WEBHOOK_SECRET=<same value as Hermes webhook route secret>

CODE_REPO_PATH=/absolute/path/to/repo
CHROMA_URL=http://127.0.0.1:8000
CHROMA_COLLECTION=codebase
OLLAMA_HOST=http://127.0.0.1:11434
OLLAMA_EMBED_MODEL=nomic-embed-text
CODE_CHUNK_SIZE=1800
CODE_CHUNK_OVERLAP=200
CODE_SEARCH_RESULTS=5
Critical secret alignment:

Hermes TASK_WORKER_SECRET must match task-worker HERMES_SECRET

Code-search callers must use the same CODE_SEARCH_HMAC_SECRET as task-worker

In this setup, CODE_SEARCH_HMAC_SECRET can intentionally reuse the same shared local HMAC secret already used between your trusted services

Hermes webhook route secret must match HERMES_WEBHOOK_SECRET

Hermes configuration
Hermes still needs its webhook route so task-worker can post results back into the gateway. The callback route name remains task-worker-result, and Hermes must still allow private URLs for local routing.

A working shape is:

text
platforms:
  webhook:
    enabled: true
    extra:
      port: 8644
      secret: "global-fallback-secret"
      routes:
        task-worker-result:
          secret: "<shared webhook secret>"
          prompt: |
            OpenClaw returned a delegated task result.

            Task ID: {task_id}
            Conversation ID: {conversation_id}
            Status: {status}
            Summary: {summary}
            Error: {error}

            Details:
            {details}
          deliver: log

security:
  allow_private_urls: true
Hermes hook
Hermes signs outbound delegated requests to POST /task using HMAC SHA-256 with the exact raw JSON bytes. The signature is sent in x-hermes-signature and must match what task-worker computes from req.rawBody.

That raw-body requirement also applies to /api/search-codebase, which now uses the same HMAC pattern but with x-code-search-signature and CODE_SEARCH_HMAC_SECRET.

Code-memory route wiring
The code-search route is now modular instead of being defined inline in task-worker.js.

task-worker.js mounts it with:

js
app.use("/api", searchCodebaseRouter);
The route file handles:

parsing query and optional n_results

verifying x-code-search-signature

calling searchCodebase(query, n_results)

returning { success, query, count, results }

This keeps the main worker focused on transport and keeps code-memory concerns isolated under routes/ and services/code-memory/.

Indexing flow
services/code-memory/indexer.js walks the configured repository, skips ignored directories, filters by configured extensions, chunks file contents, generates embeddings with Ollama, and upserts those chunks into ChromaDB.

scripts/reindex-codebase.js simply imports the indexer entrypoint so npm run index-codebase triggers a full reindex pass.

Search flow
services/code-memory/search.js embeds the incoming query with the configured Ollama embedding model, queries the configured Chroma collection, and returns ranked chunks with:

file

fullPath

chunk

distance

content

The route at /api/search-codebase exposes that retrieval over HTTP for trusted internal callers.

Verification steps
1. Syntax check
bash
npm run check
This validates the main worker, route, script, and code-memory modules before runtime.

2. Start dependencies
Start ChromaDB and ensure Ollama is running with the embedding model available.

bash
ollama pull nomic-embed-text
Example ChromaDB start:

bash
docker run -d \
  --name chroma \
  -p 8000:8000 \
  -v chroma_data:/chroma/chroma \
  -e IS_PERSISTENT=TRUE \
  -e ANONYMIZED_TELEMETRY=false \
  chromadb/chroma:latest
3. Reindex the repository
bash
npm run index-codebase
A successful run should print indexed files and a final JSON summary including repo path, indexed file count, indexed chunk count, and collection name.

4. Start the worker
bash
npm start
The worker should bind to the configured host and port and expose both the task flow and the code-search route.

5. Test code search
Unsigned testing is acceptable only if CODE_SEARCH_HMAC_SECRET is empty. If it is set, the caller must sign the exact request body.

Example signed test:

bash
SECRET='<CODE_SEARCH_HMAC_SECRET>'
BODY='{"query":"Where is HMAC validation implemented?","n_results":5}'
DIGEST=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | sed 's/^.* //')
SIG="sha256=$DIGEST"

curl -v http://127.0.0.1:9000/api/search-codebase \
  -H "content-type: application/json" \
  -H "x-code-search-signature: $SIG" \
  -d "$BODY"
The expected response shape is:

json
{
  "success": true,
  "query": "Where is HMAC validation implemented?",
  "count": 5,
  "results": [
    {
      "file": "task-worker.js",
      "fullPath": "/absolute/path/to/repo/task-worker.js",
      "chunk": 0,
      "distance": 0.123,
      "content": "..."
    }
  ]
}
6. Verify Hermes transport flow
Use the same signed /task testing pattern as before to confirm Hermes delegation still works after the code-memory changes.

systemd note
Hermes environment propagation through systemd user services remains important. The reliable validation method is still checking the live process environment via /proc/$PID/environ instead of assuming systemctl show ... --property=Environment is complete.

Current status
The current system now supports both:

Hermes -> task-worker -> OpenClaw -> Hermes delegated execution

trusted caller -> task-worker /api/search-codebase -> ChromaDB/Ollama semantic code retrieval

That gives task-worker-rag a clean role as both a transport broker and a repo-aware retrieval service.

Secret reuse note
For the current local setup, CODE_SEARCH_HMAC_SECRET may reuse the same shared HMAC secret already used across your trusted worker/Hermes wiring.

That keeps configuration simple while everything remains inside the same trust boundary. If the code-search route later gets broader access, move it to a dedicated secret.