# task-worker-rag

A local task broker and semantic code-search service that connects **Hermes**, **OpenClaw**, **ChromaDB**, and **Ollama** into one runtime.

`task-worker-rag` does two jobs: it forwards delegated work between Hermes and OpenClaw, and it exposes a signed semantic code-search API backed by embeddings and vector search.

## What it does

- Brokers delegated tasks from Hermes to OpenClaw and posts results back through the Hermes webhook flow.
- Exposes `POST /api/search-codebase` for trusted semantic repository search.
- Uses Ollama to generate embeddings and ChromaDB to store and retrieve indexed code chunks.
- Keeps routing, indexing, and search logic split into dedicated modules while running from a single Express service.

## Architecture

### Delegated task flow

```text
Hermes hook
  -> task-worker /task
  -> OpenClaw /v1/chat/completions
  -> task-worker
  -> Hermes webhook
```

### Code search flow

```text
Caller
  -> task-worker /api/search-codebase
  -> Ollama embeddings
  -> ChromaDB similarity search
  -> matching code chunks
```

## Services and ports

| Service | Default URL | Purpose |
|---|---|---|
| Hermes webhook listener | `http://127.0.0.1:8644` | Receives task results. |
| task-worker | `http://127.0.0.1:9000` | Main broker and code-search API. |
| OpenClaw gateway | `http://127.0.0.1:18789` | Delegated execution backend. |
| ChromaDB | `http://127.0.0.1:8000` | Vector storage for indexed code. |
| Ollama | `http://127.0.0.1:11434` | Embedding model host. |

## Project layout

```text
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
```

### File responsibilities

- `task-worker.js` — Express server entrypoint, transport wiring, HMAC verification, and listener startup.
- `routes/search-codebase.js` — HTTP route for semantic code search.
- `services/code-memory/indexer.js` — repository indexing into ChromaDB.
- `services/code-memory/search.js` — semantic retrieval for code chunks.
- `scripts/reindex-codebase.js` — one-shot indexing command entrypoint.

## API surface

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/task` | Accept delegated work from Hermes. |
| `POST` | `/result` | Receive OpenClaw callbacks when callback mode is used. |
| `POST` | `/api/search-codebase` | Run signed semantic repository search. |
| `GET` | `/` | Basic service check. |
| `GET` | `/health` | Health endpoint. |

## Installation

### 1. Install dependencies

```bash
npm install
```

### 2. Start required services

Make sure these are running before indexing or searching:

- ChromaDB
- Ollama with the embedding model available
- Hermes webhook listener
- OpenClaw gateway

Pull the embedding model if needed:

```bash
ollama pull nomic-embed-text
```

Example ChromaDB startup:

```bash
docker run -d \
  --name chroma \
  -p 8000:8000 \
  -v chroma_data:/chroma/chroma \
  -e IS_PERSISTENT=TRUE \
  -e ANONYMIZED_TELEMETRY=false \
  chromadb/chroma:latest
```

## Configuration

The service needs both transport settings and code-memory settings.

### Environment variables

```env
AGENT_NAME=Claw
HOST=127.0.0.1
PORT=9000

HERMES_SECRET=
OPENCLAW_SECRET=
CODE_SEARCH_HMAC_SECRET=

OPENCLAW_URL=http://127.0.0.1:18789/v1/chat/completions
OPENCLAW_API_KEY=

HERMES_WEBHOOK_URL=http://127.0.0.1:8644/webhooks/task-worker-result
HERMES_WEBHOOK_SECRET=

CODE_REPO_PATH=/absolute/path/to/repo
CHROMA_URL=http://127.0.0.1:8000
CHROMA_COLLECTION=codebase
OLLAMA_HOST=http://127.0.0.1:11434
OLLAMA_EMBED_MODEL=nomic-embed-text
CODE_CHUNK_SIZE=1800
CODE_CHUNK_OVERLAP=200
CODE_SEARCH_RESULTS=5
```

### Secret alignment

These values must match across services:

- Hermes `TASK_WORKER_SECRET` must match task-worker `HERMES_SECRET`.
- Code-search callers must sign requests with `CODE_SEARCH_HMAC_SECRET`.
- Hermes webhook route secret must match `HERMES_WEBHOOK_SECRET`.
- In a fully local trusted setup, `CODE_SEARCH_HMAC_SECRET` can reuse the same shared HMAC secret already used between worker and Hermes.

## npm scripts

```json
{
  "scripts": {
    "start": "node task-worker.js",
    "dev": "node --watch task-worker.js",
    "index-codebase": "node scripts/reindex-codebase.js",
    "check": "node --check task-worker.js && node --check routes/search-codebase.js && node --check scripts/reindex-codebase.js && node --check services/code-memory/config.js && node --check services/code-memory/indexer.js && node --check services/code-memory/search.js"
  }
}
```

### Script meanings

- `npm start` — start the Express server.
- `npm run dev` — run the server in watch mode.
- `npm run index-codebase` — perform a full repository indexing pass.
- `npm run check` — syntax-check the worker, route, script, and code-memory modules.

## Getting started

### 1. Validate the code

```bash
npm run check
```

### 2. Index the repository

```bash
npm run index-codebase
```

A successful indexing run should report the repository path, indexed file count, indexed chunk count, and collection name.

### 3. Start the worker

```bash
npm start
```

The service should bind to the configured host and port and expose both delegated task handling and the code-search route.

## Search API example

Unsigned requests are only acceptable when `CODE_SEARCH_HMAC_SECRET` is empty.

```bash
SECRET='<CODE_SEARCH_HMAC_SECRET>'
BODY='{"query":"Where is HMAC validation implemented?","n_results":5}'
DIGEST=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | sed 's/^.* //')
SIG="sha256=$DIGEST"

curl -v http://127.0.0.1:9000/api/search-codebase \
  -H "content-type: application/json" \
  -H "x-code-search-signature: $SIG" \
  -d "$BODY"
```

Expected response shape:

```json
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
```

## Hermes webhook config

Hermes must keep a webhook route so task-worker can post results back into the gateway, and local/private URLs must be allowed for this setup.

```yaml
platforms:
  webhook:
    enabled: true
    extra:
      port: 8644
    secret: "global-fallback-secret"
    routes:
      task-worker-result:
        secret: ""
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
```

## Security notes

- Hermes signs outbound `POST /task` requests using HMAC SHA-256 over the exact raw JSON body, sent in `x-hermes-signature`.
- `/api/search-codebase` follows the same raw-body verification pattern using `x-code-search-signature` and `CODE_SEARCH_HMAC_SECRET`.
- Raw body handling matters for signature validation on both routes.
- Reusing the same HMAC secret is acceptable inside a single trusted local boundary, but a dedicated secret is safer if the search route later gets broader access.

## How indexing works

`services/code-memory/indexer.js` walks the configured repository, skips ignored directories, filters allowed file extensions, chunks file contents, generates embeddings through Ollama, and upserts the chunks into ChromaDB.

`scripts/reindex-codebase.js` is a thin wrapper that triggers a full indexing pass through the npm script.

## How search works

`services/code-memory/search.js` embeds the incoming query, searches the configured Chroma collection, and returns ranked chunks with file metadata and content.

The `/api/search-codebase` route returns a normalized payload in the form `{ success, query, count, results }`.

## systemd note

When running Hermes through a user systemd service, validate environment propagation from the live process environment such as `/proc/$PID/environ` instead of assuming `systemctl show ... --property=Environment` is complete.

## Current role

At its current stage, `task-worker-rag` acts as both of the following:

- A transport broker for `Hermes -> task-worker -> OpenClaw -> Hermes` delegated execution.
- A repository-aware retrieval service for trusted callers using `task-worker /api/search-codebase -> ChromaDB/Ollama` semantic search.

## Current state and roadmap

### Topology (verified)

Hermes hook ─signed POST─▶ task-worker `/task` ─▶ OpenClaw `/v1/chat/completions` ─▶ task-worker ─signed POST─▶ Hermes `/webhooks/task-worker-result`

External callers may also push work directly into Hermes via the signed inbound route at `/webhooks/external-delegation`, which then runs an internal subagent and (on `subagent_stop`) fires the `task-worker-dispatch` hook back to task-worker.

### Endpoints and ports

| Service       | Bind              | Notes                                                        |
| ------------- | ----------------- | ------------------------------------------------------------ |
| Hermes        | `127.0.0.1:8644`  | Webhook listener; routes under `/webhooks/{route_name}`      |
| task-worker   | `127.0.0.1:9000`  | Node/Express; `/`, `POST /task`, `POST /result`, `POST /api/search-codebase` |
| OpenClaw      | `127.0.0.1:18789` | OpenAI-compatible API; companion admin port on `18791` (401-gated) |

### Auth and signing

- Hermes → task-worker `/task`: HMAC-SHA256 of raw body using `TASK_WORKER_SECRET` (Hermes) == `HERMES_SECRET` (task-worker), sent as `x-hermes-signature: sha256=<hex>`.
- External → Hermes `/webhooks/external-delegation`: HMAC-SHA256 of raw body using the route secret, sent as `X-Webhook-Signature: <bare hex>`.
- task-worker → Hermes `/webhooks/task-worker-result`: HMAC-SHA256 of raw body using the route secret, sent as `x-webhook-signature: <bare hex>`.
- task-worker → OpenClaw `/v1/chat/completions`: `Authorization: Bearer ${OPENCLAW_API_KEY}`.
- OpenClaw → task-worker `/result` (if used): HMAC using `OPENCLAW_SECRET`, header `x-openclaw-signature`.

### One-command health check

For a single command that verifies listeners, endpoints, and a signed inbound delivery into Hermes, use:

```bash
./scripts/healthcheck.sh
```

It exits `0` if everything is healthy and non-zero on the first failure. See `docs/RUNBOOK.md` for options (`--quiet`, `--json`) and how to run it on a schedule.

### Reference: signed Hermes-style POST to task-worker

```bash
SECRET="$TASK_WORKER_SECRET"   # same as HERMES_SECRET on task-worker
BODY='{
  "task_id": "smoke-test",
  "goal": "Smoke test Hermes -> task-worker -> OpenClaw -> Hermes",
  "context": {
    "source_event": "manual_test",
    "parent_session_id": "smoke-session",
    "child_role": "tester",
    "child_status": "ok",
    "duration_ms": 100,
    "emitted_at": "2026-05-21T18:00:00Z"
  },
  "constraints": { "timeout_sec": 60, "tools_allowed": [] },
  "expected_output": { "format": "json" },
  "result_hint": { "summary": "smoke test", "status": "ok" }
}'

DIGEST=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | sed 's/^.* //')
SIG="sha256=$DIGEST"

curl -v http://127.0.0.1:9000/task \
  -H "content-type: application/json" \
  -H "x-hermes-signature: $SIG" \
  -H "x-request-id: smoke-test" \
  -d "$BODY"
```

A `202 Accepted` confirms HMAC, schema, and transport are healthy.

### Reference: signed external delivery into Hermes

```bash
SECRET="$HERMES_EXTERNAL_DELEGATION_SECRET"   # value of platforms.webhook.routes.external-delegation.secret

BODY='{
  "task": "Reply briefly confirming Hermes received this delegation.",
  "repository": "task-worker-rag",
  "output_requirements": "Return a short JSON object with status, agent, and message."
}'

SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | awk '{print $2}')

curl -v http://127.0.0.1:8644/webhooks/external-delegation \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Signature: $SIG" \
  -d "$BODY"
```

A `202 Accepted` with a `delivery_id` confirms inbound is healthy. Note this is non-blocking — the subagent runs asynchronously.

### systemd

User-mode services (run on login; enable `loginctl enable-linger larry` to start at boot):

```bash
# Status / logs
systemctl --user status hermes-gateway openclaw-gateway task-worker
journalctl --user -u hermes-gateway -f
journalctl --user -u openclaw-gateway -f
journalctl --user -u task-worker -f

# Restart
systemctl --user restart hermes-gateway
systemctl --user restart openclaw-gateway
systemctl --user restart task-worker
```

Canonical config locations:

- Hermes config: `/home/larry/.hermes/config.yaml`
- Hermes hook: `/home/larry/.hermes/hooks/task-worker-dispatch/HOOK.yaml`
- Hermes env: `~/.config/systemd/user/hermes-gateway.env`
- task-worker unit/env: `~/.config/systemd/user/<task-worker>.service` (+ env file)
- OpenClaw unit: `~/.config/systemd/user/openclaw-gateway.service`
- task-worker runtime: `~/Development/task-worker-rag`
- (Optional) RAG corpus: `~/.hermes/repos/<repo_name>`

### What works today

- ✅ task-worker `/`, `/task`, and `/result` behaviors (including `bad_signature`, `missing_goal`, `duplicate`, `needs_input`, `task_processing_failed`).
- ✅ task-worker ↔ OpenClaw round trip via Bearer-authenticated `/v1/chat/completions`.
- ✅ External → Hermes signed inbound at `/webhooks/external-delegation` returns `202 Accepted` reliably.
- ✅ task-worker → Hermes signed callback to `/webhooks/task-worker-result`.
- ✅ `task-worker-dispatch` hook registered for `subagent_stop`.
- ✅ task-worker runs as a systemd user service, logs visible via `journalctl --user -u <task-worker> -f`.
- ✅ Hermes inbound deliveries spawn real subagents (observed actual tool-call attempts in logs).
- ✅ Code memory wiring scoped by `repo_name`, with `package-lock.json` excluded and file-level reranking surfacing the correct file.

### Known limitations

- ⚠️ Hermes subagents using `gpt-oss:20b` often try to call tools that aren’t registered (`repo_browser.*`, `container.exec`, `filesystem.exec`, `assistant`, …) and end as `partial`, so `subagent_stop` does not always emit a clean result back through `task-worker-dispatch`.
- ⚠️ Telegram → Hermes → task-worker is not auto-wired. The Telegram persona currently has no “delegate to task-worker” tool; inbound webhook + hook is the supported machine-driven path.
- ⚠️ Code-memory chunking is fixed-character; the right file is usually surfaced, but the exact in-file snippet is not always the best match (e.g., function-level precision needs work).
- ⚠️ Default logging is INFO. Deep debugging requires `LOG_LEVEL=DEBUG` and ideally foreground runs.

### Roadmap (rough priority)

1. Tighten Hermes subagent runtime
   - Constrain prompts/toolsets, or align model to installed tools, or replace `gpt-oss:20b` with a model whose tool repertoire matches Hermes.
   - Capture one full delivery → subagent run with `LOG_LEVEL=DEBUG` in foreground to lock down the failure mode.
2. End-to-end observability
   - Standardize a `x-correlation-id` across Hermes → task-worker → OpenClaw → Hermes.
   - Add a small “debug sink” endpoint on task-worker to record the latest subagent result from `task-worker-dispatch`.
3. Optional: Telegram → task-worker bridge
   - Add a Hermes-side tool/hook (only on the Telegram persona) that signs and POSTs to `TASK_WORKER_URL`.
4. Code-memory quality
   - Chunk-level reranking (exact-symbol boost), then structure-aware chunking (functions/classes/routes).
   - Add metadata for filtering (language, kind, repo path) and surface it in API responses.
   - Automate reindexing (Git hook, systemd timer, or webhook).
5. Operational hardening
   - `EnvironmentFile=` per service, explicit `WorkingDirectory=` and `Type=simple`.
   - `loginctl enable-linger` so user services come up at boot without login.
   - Status section + smoke-test script in README.
6. Persistence and resilience (later)
   - Move task-worker’s in-memory route table to SQLite/Redis.
   - Extend idempotency beyond `task_id` (delivery_id, time-windowed dedupe).
   - Multi-repo support and multi-agent routing in task-worker.

### How to come back to this

If picking this up fresh:

1. Verify listeners: `ss -ltnp | grep -E '8644|9000|18789'`.
2. Confirm task-worker is healthy: `curl http://127.0.0.1:9000/`.
3. Send a signed task to task-worker (see “Reference: signed Hermes-style POST”) and confirm `202 Accepted`.
4. Send a signed inbound to Hermes (`./scripts/hermes-inbound-test.sh`) and confirm `202 Accepted` with `delivery_id`.
5. Pick one item from the roadmap and scope it as a single focused session.