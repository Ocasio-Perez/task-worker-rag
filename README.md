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
Hermes hook or signed caller
  -> task-worker /task
  -> OpenClaw /v1/chat/completions
  -> task-worker forwardToHermes()
  -> Hermes /webhooks/task-worker-result
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
| OpenClaw admin | `http://127.0.0.1:18791` | Companion admin port, 401-gated. |
| ChromaDB | `http://127.0.0.1:8000` | Vector storage for indexed code. |
| Ollama | `http://127.0.0.1:11434` | Embedding model host. |

## Project layout

```text
task-worker-rag/
├── README.md
├── docs/
│   ├── CODEMEMORY.md
│   └── RUNBOOK.md
├── package.json
├── task-worker.js
├── routes/
│   ├── read-file.js
│   └── search-codebase.js
├── scripts/
│   └── reindex-codebase.js
└── services/
    ├── code-memory/
    │   ├── config.js
    │   ├── indexer.js
    │   ├── search.js
    │   └── tools.js
    └── security/
        └── hmac.js
```

### File responsibilities

- `task-worker.js` — Express server entrypoint, transport wiring, HMAC verification, OpenClaw forwarding, Hermes relay, and listener startup.
- `routes/read-file.js` — HTTP route for signed repo-confined file reads.
- `routes/search-codebase.js` — HTTP route for semantic code search.
- `services/code-memory/indexer.js` — repository indexing into ChromaDB.
- `services/code-memory/search.js` — semantic retrieval for code chunks.
- `services/code-memory/tools.js` — shared contract layer for search and read-file code tools.
- `services/security/hmac.js` — shared HMAC signing and timing-safe verification helpers.
- `integrations/hermes/plugins/task-worker-code-tools/` — Hermes plugin exposing `code_search` and `code_read_file`.
- `integrations/hermes/quick-commands/` — deterministic local code-inspection command wrappers for Hermes quick commands.
- `scripts/reindex-codebase.js` — one-shot indexing command entrypoint.

## API surface

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/task` | Accept delegated work from Hermes or another signed caller. |
| `POST` | `/result` | Receive OpenClaw callbacks when callback mode is used. |
| `POST` | `/api/search-codebase` | Run signed semantic repository search. |
| `POST` | `/api/read-file` | Read a signed, repo-confined source file. |
| `GET` | `/` | Basic service check. |
| `GET` | `/health` | Health endpoint. |

## Installation

### 1. Install dependencies

```bash
npm install
```

### 2. Start required services

Make sure these are running before indexing, searching, or delegating tasks:

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

The service reads underscore-style environment variable names.

```env
AGENT_NAME=Claw
HOST=127.0.0.1
PORT=9000

# Hermes -> task-worker /task verification
HERMES_SECRET=

# task-worker -> OpenClaw
OPENCLAW_URL=http://127.0.0.1:18789/v1/chat/completions
OPENCLAW_API_KEY=
OPENCLAW_MODEL=openclaw

# OpenClaw -> task-worker /result, if callback mode is used
OPENCLAW_SECRET=

# task-worker -> Hermes /webhooks/task-worker-result
HERMES_WEBHOOK_URL=http://127.0.0.1:8644/webhooks/task-worker-result
HERMES_WEBHOOK_SECRET=

# Repository routing
REPO_ROOT=/home/larry/.hermes/repos

# Code search
CODE_SEARCH_HMAC_SECRET=
CHROMA_URL=http://127.0.0.1:8000
CHROMA_COLLECTION=codebase
OLLAMA_HOST=http://127.0.0.1:11434
OLLAMA_EMBED_MODEL=nomic-embed-text
CODE_CHUNK_SIZE=1800
CODE_CHUNK_OVERLAP=200
CODE_SEARCH_RESULTS=5

# Logging
LOG_LEVEL=INFO
```

### Repository routing

When `REPO_ROOT` is set, `/task` requests should include `repo_name`.

Example:

```json
{
  "task_id": "smoke-test-123",
  "repo_name": "task-worker-rag",
  "goal": "Smoke test the delegated task path"
}
```

If `repo_name` is missing, task-worker returns:

```json
{
  "status": "needs_input",
  "error": "missing_repo_name",
  "summary": "A repository name is required before I can continue."
}
```

## Auth and signing

- Hermes -> task-worker `/task`: HMAC-SHA256 over the exact raw JSON body using `HERMES_SECRET`, sent as `X-Hermes-Signature: sha256=<hex>`.
- task-worker -> Hermes `/webhooks/task-worker-result`: HMAC-SHA256 over the exact raw JSON body using `HERMES_WEBHOOK_SECRET`, sent as `X-Webhook-Signature: <bare_hex>`.
- External -> Hermes `/webhooks/external-delegation`: HMAC-SHA256 over the exact raw JSON body using the Hermes route secret, sent as `X-Webhook-Signature: <bare_hex>`.
- task-worker -> OpenClaw `/v1/chat/completions`: `Authorization: Bearer ${OPENCLAW_API_KEY}`.
- OpenClaw -> task-worker `/result`, if callback mode is used: HMAC using `OPENCLAW_SECRET`, sent as `X-OpenClaw-Signature`.
- Code-search callers -> `/api/search-codebase`: HMAC-SHA256 using `CODE_SEARCH_HMAC_SECRET`, sent as `X-Code-Search-Signature: sha256=<hex>`.

Raw body handling matters. Any JSON reformatting between signing and sending will invalidate the signature.

## Secret alignment

These values must match across services:

- Hermes `TASK_WORKER_SECRET` must match task-worker `HERMES_SECRET`.
- Hermes webhook route secret for `task-worker-result` must match task-worker `HERMES_WEBHOOK_SECRET`.
- Code-search callers must sign requests with `CODE_SEARCH_HMAC_SECRET`.
- In a fully local trusted setup, `CODE_SEARCH_HMAC_SECRET` can reuse another local HMAC secret, but a dedicated secret is safer if the search API later gets broader access.

## npm scripts

```json
{
  "scripts": {
    "start": "node task-worker.js",
    "dev": "node --watch task-worker.js",
    "code-read": "node tools/readFileCli.js",
    "code-search": "node tools/searchCodebaseCli.js",
    "index-codebase": "node scripts/reindex-codebase.js",
    "cleanup-index": "node scripts/cleanup-repo-index.js",
    "check": "node --check task-worker.js && node --check routes/search-codebase.js && node --check routes/read-file.js && node --check scripts/reindex-codebase.js && node --check scripts/cleanup-repo-index.js && node --check services/code-memory/config.js && node --check services/code-memory/indexer.js && node --check services/code-memory/search.js && node --check services/code-memory/tools.js && node --check services/security/hmac.js && node --check tools/callCodeSearch.js && node --check tools/callReadFile.js && node --check tools/searchCodebaseCli.js && node --check tools/readFileCli.js",
    "reindex-codebase": "node scripts/reindex-codebase.js"
  }
}
```

### Script meanings

- `npm start` — start the Express server.
- `npm run dev` — run the server in watch mode.
- `npm run code-read -- --repo <repo_name> <relative_path>` — call signed read-file and print file content.
- `npm run code-search -- --repo <repo_name> "<query>"` — call signed code search and print readable terminal output.
- `npm run index-codebase -- <repo_name>` — perform a full repository indexing pass.
- `npm run cleanup-index -- <repo_name>` — delete indexed chunks for one repository.
- `npm run check` — syntax-check the worker, route, script, and code-memory modules.

## Getting started

### 1. Validate the code

```bash
npm run check
```

### 2. Index the repository

```bash
npm run index-codebase -- task-worker-rag
```

A successful indexing run should report the repository path, indexed file count, indexed chunk count, and collection name.

### 3. Start the worker

```bash
npm start
```

The service should bind to the configured host and port and expose both delegated task handling and the code-search route.

## Search API example

Unsigned requests are only acceptable when `CODE_SEARCH_HMAC_SECRET` is empty.

For readable terminal output, use the helper CLI:

```bash
npm run code-search -- --repo task-worker-rag "Where is HMAC validation implemented?"
```

Use `--content` to print full matching chunks or `--json` to print the raw response.

```bash
SECRET="$CODE_SEARCH_HMAC_SECRET"
BODY='{"repo_name":"task-worker-rag","query":"Where is HMAC validation implemented?","n_results":5}'
DIGEST="$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | awk '{print $2}')"
SIG="sha256=$DIGEST"

curl -v http://127.0.0.1:9000/api/search-codebase \
  -H "Content-Type: application/json" \
  -H "X-Code-Search-Signature: $SIG" \
  -d "$BODY"
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

## Read-file API example

Use the helper CLI for readable output:

```bash
npm run code-read -- --repo task-worker-rag task-worker.js
```

Raw signed request:

```bash
SECRET="$CODE_SEARCH_HMAC_SECRET"
BODY='{"repo_name":"task-worker-rag","relative_path":"task-worker.js","max_bytes":8000}'
DIGEST="$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | awk '{print $2}')"
SIG="sha256=$DIGEST"

curl -v http://127.0.0.1:9000/api/read-file \
  -H "Content-Type: application/json" \
  -H "X-Code-Search-Signature: $SIG" \
  -d "$BODY"
```

Expected response shape:

```json
{
  "success": true,
  "ok": true,
  "repo_name": "task-worker-rag",
  "relative_path": "task-worker.js",
  "bytes": 8000,
  "total_bytes": 12000,
  "truncated": true,
  "content": "..."
}
```

## Hermes code tools plugin

Hermes agents need a plugin before they can call task-worker code tools by name.
This repo includes one at `integrations/hermes/plugins/task-worker-code-tools/`.

Install or update it on the WSL machine where Hermes runs:

```bash
cd ~/Development/task-worker-rag
git pull --ff-only origin main

mkdir -p ~/.hermes/plugins/task-worker-code-tools
cp -R integrations/hermes/plugins/task-worker-code-tools/* \
  ~/.hermes/plugins/task-worker-code-tools/
```

Enable it as a top-level plugin in `~/.hermes/config.yaml`:

```yaml
plugins:
  enabled:
    - task-worker-code-tools
```

The plugin registers collision-safe tool names:

- `code_search`
- `code_read_file`

It accepts both Hermes handler calling styles: a single params object or keyword
arguments. See `docs/HERMES_CODE_TOOLS.md` for the full install, environment,
and smoke-test flow.

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

          Task ID: {taskid}
          Conversation ID: {conversationid}
          Status: {status}
          Summary: {summary}
          Error: {error}

          Details:
          {details}
        deliver: log
security:
  allow_private_urls: true
```

The route can also use `{task_id}` and `{conversation_id}` if preferred, because task-worker includes both compact and snake_case aliases in the callback payload.

## Hermes callback payload

Task-worker posts results back to Hermes at `HERMES_WEBHOOK_URL`.

The callback body includes both compact and snake_case identifiers:

```json
{
  "taskid": "smoke-test-1779895647",
  "task_id": "smoke-test-1779895647",
  "conversationid": "smoke-session",
  "conversation_id": "smoke-session",
  "status": "ok",
  "summary": "OpenClaw completed the delegated task",
  "details": {},
  "error": null
}
```

Hermes templates may use `taskid` and `conversationid`; JSON/API consumers may prefer `task_id` and `conversation_id`.

## End-to-end smoke test

This verifies Hermes-style signing into task-worker, repository routing, OpenClaw execution, and the signed callback back into Hermes.

```bash
TASK_ID="smoke-test-$(date +%s)"
SECRET="$HERMES_SECRET"

BODY="$(cat <<JSON
{"task_id":"$TASK_ID","repo_name":"task-worker-rag","goal":"Smoke test Hermes - task-worker - OpenClaw - Hermes callback","context":{"source":"manual-test"},"parent_session_id":"smoke-session","child_role":"tester","child_status":"ok","duration_ms":100,"emitted_at":"$(date -Is)","constraints":{"timeout_sec":60,"tools_allowed":[]},"expected_output":{"format":"json"},"result_hint":{"summary":"smoke test","status":"ok"}}
JSON
)"

SIG="$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | awk '{print "sha256="$2}')"

echo "TASK_ID=$TASK_ID"

curl -v http://127.0.0.1:9000/task \
  -H 'Content-Type: application/json' \
  -H "X-Hermes-Signature: $SIG" \
  -H "X-Request-Id: $TASK_ID" \
  -d "$BODY"
```

A successful task-worker relay log looks like this:

```text
[Hermes relay] posting {
  taskid: 'smoke-test-...',
  url: 'http://127.0.0.1:8644/webhooks/task-worker-result',
  signed: true
}
[Hermes relay] response {
  taskid: 'smoke-test-...',
  status: 202,
  body: '{"status": "accepted", "route": "task-worker-result", ...}'
}
```

A `202 Accepted` from Hermes confirms the callback route, signature, and relay are healthy.

## Reference: signed external delivery into Hermes

External callers may push work directly into Hermes via `/webhooks/external-delegation`. Hermes can then run an internal subagent and, on `subagent_stop`, fire the `task-worker-dispatch` hook back to task-worker.

```bash
SECRET="$HERMES_EXTERNAL_DELEGATION_SECRET"

BODY='{
  "task": "Reply briefly confirming Hermes received this delegation.",
  "repository": "task-worker-rag",
  "output_requirements": "Return a short JSON object with status, agent, and message."
}'

SIG="$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | awk '{print $2}')"

curl -v http://127.0.0.1:8644/webhooks/external-delegation \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Signature: $SIG" \
  -d "$BODY"
```

A `202 Accepted` with a `delivery_id` confirms inbound delivery is healthy. This is non-blocking; the subagent runs asynchronously.

## systemd

This deployment uses user-mode services. Enable linger if the services should start at boot without an interactive login:

```bash
loginctl enable-linger larry
```

Status and logs:

```bash
systemctl --user status hermes-gateway.service openclaw-gateway.service task-worker-rag.service

journalctl --user -u hermes-gateway.service -f
journalctl --user -u openclaw-gateway.service -f
journalctl --user -u task-worker-rag.service -f
```

Restart:

```bash
systemctl --user restart hermes-gateway.service
systemctl --user restart openclaw-gateway.service
systemctl --user restart task-worker-rag.service
```

If the task-worker service name differs, discover it with:

```bash
systemctl --user list-units --type=service --all | grep -Ei 'task|worker|rag'
ss -ltnp | grep ':9000'
```

Canonical config locations:

- Hermes config: `/home/larry/.hermes/config.yaml`
- Hermes hook: `/home/larry/.hermes/hooks/task-worker-dispatch/HOOK.yaml`
- Hermes env: `~/.config/systemd/user/hermes-gateway.env`
- task-worker unit/env: `~/.config/systemd/user/task-worker-rag.service` plus its environment file
- OpenClaw unit: `~/.config/systemd/user/openclaw-gateway.service`
- task-worker runtime: `~/Development/task-worker-rag`
- Optional RAG corpus: `~/.hermes/repos/<repo_name>`

## systemd env validation

When running services through user systemd, validate environment propagation from the live process instead of assuming `systemctl show --property=Environment` is complete.

```bash
PID="$(ss -ltnp | awk -F'pid=' '/:9000/{split($2,a,","); print a[1]; exit}')"

tr '\0' '\n' < /proc/"$PID"/environ \
  | grep -E 'HERMES_SECRET|HERMES_WEBHOOK_URL|HERMES_WEBHOOK_SECRET|OPENCLAW|REPO_ROOT|PORT'
```

## Current verified state

As of 2026-05-27, the full local loop has been verified:

```text
Hermes-style signed /task
  -> task-worker-rag
  -> OpenClaw /v1/chat/completions
  -> task-worker-rag forwardToHermes()
  -> Hermes /webhooks/task-worker-result
  -> 202 Accepted
```

A verified callback returned:

```json
{
  "status": "accepted",
  "route": "task-worker-result",
  "event": "unknown",
  "delivery_id": "1779895676387"
}
```

## What works today

- `task-worker` `/`, `/task`, and `/result` behaviors, including `bad_signature`, `missing_goal`, `duplicate`, `needs_input`, and `task_processing_failed`.
- task-worker -> OpenClaw round trip via Bearer-authenticated `/v1/chat/completions`.
- External -> Hermes signed inbound at `/webhooks/external-delegation` returns `202 Accepted`.
- task-worker -> Hermes signed callback to `/webhooks/task-worker-result` returns `202 Accepted`.
- `task-worker-dispatch` hook registered for `subagent_stop`.
- task-worker runs as a systemd user service, with logs visible through `journalctl --user -u task-worker-rag.service -f`.
- Hermes inbound deliveries spawn real subagents.
- Code-memory wiring is scoped by `repo_name`, with `package-lock.json` excluded and file-level reranking surfacing the correct file.

## Known limitations

- Hermes subagents using `gpt-oss:20b` often try to call tools that are not registered, such as `repo_browser.*`, `container.exec`, `filesystem.exec`, and `assistant`, and may end as `partial`.
- Telegram -> Hermes -> task-worker is not auto-wired. The Telegram persona currently has no “delegate to task-worker” tool; inbound webhook plus hook is the supported machine-driven path.
- Code-memory chunking is fixed-character. The right file is usually surfaced, but the exact in-file snippet is not always the best match.
- Default logging is `INFO`. Deep debugging requires `LOG_LEVEL=DEBUG` and ideally foreground runs.

## Roadmap

### 1. Tighten Hermes subagent runtime

- Constrain prompts and toolsets.
- Align the model to installed tools.
- Replace `gpt-oss:20b` if another model better matches Hermes’ actual tool repertoire.
- Capture one full delivery-to-subagent run with `LOG_LEVEL=DEBUG` in foreground.

### 2. Improve observability

- Standardize a `X-Correlation-Id` across Hermes -> task-worker -> OpenClaw -> Hermes.
- Keep compact relay logs for task-worker -> Hermes callback status.
- Add a debug sink endpoint on task-worker to record the latest subagent result from `task-worker-dispatch`.

### 3. Optional Telegram bridge

- Add a Hermes-side tool or hook only on the Telegram persona that signs and POSTs to task-worker.
- Keep the existing inbound webhook plus hook flow as the machine-driven path.

### 4. Improve code memory

- Add chunk-level reranking with exact-symbol boosts.
- Move toward structure-aware chunking for functions, classes, and routes.
- Add metadata for filtering by language, kind, repo path, and surface those fields in API responses.
- Automate reindexing with a Git hook, systemd timer, or webhook.

### 5. Harden operations

- Use `EnvironmentFile=` per service.
- Set explicit `WorkingDirectory=` and `Type=simple`.
- Keep `loginctl enable-linger larry` enabled for boot startup.
- Move smoke tests into scripts and run them on a schedule.

### 6. Add persistence later

- Move task-worker’s in-memory route table to SQLite or Redis.
- Extend idempotency beyond `task_id` with delivery IDs or time-windowed dedupe.
- Add multi-repo support and multi-agent routing.

## How to come back to this

If picking this up fresh:

1. Verify listeners:

```bash
ss -ltnp | grep -E '8644|9000|18789'
```

2. Confirm task-worker is healthy:

```bash
curl http://127.0.0.1:9000/
```

3. Confirm live env propagation:

```bash
PID="$(ss -ltnp | awk -F'pid=' '/:9000/{split($2,a,","); print a[1]; exit}')"
tr '\0' '\n' < /proc/"$PID"/environ | grep -E 'HERMES|OPENCLAW|REPO_ROOT|PORT'
```

4. Send a signed task to task-worker using the “End-to-end smoke test” section.

5. Confirm task-worker logs show Hermes relay response `status: 202`.

6. Send a signed inbound delivery to Hermes using the external delegation example if testing the Hermes hook path.
