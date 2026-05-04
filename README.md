# Hermes ↔ Task-Worker ↔ OpenClaw Wiring Guide

This guide documents a local HTTP-based wiring pattern where Hermes delegates work to a task-worker, the task-worker forwards work to OpenClaw, and OpenClaw returns results through the task-worker back into Hermes via a webhook route. Hermes supports outbound hook handlers and inbound webhook routes, while OpenClaw can be reached through its local authenticated gateway.

## Architecture

The final message flow is:

1. Hermes triggers a local hook handler.
2. The hook handler POSTs a task payload to the task-worker at `/task`.
3. The task-worker validates the request and forwards it to OpenClaw over HTTP.
4. OpenClaw completes the task and POSTs a result to the task-worker at `/result`.
5. The task-worker POSTs the result into a Hermes webhook route such as `/webhooks/task-worker-result`.

A simple mental model is:

```text
Hermes hook  ->  task-worker /task  ->  OpenClaw gateway
Hermes route <-  task-worker /result <- OpenClaw callback
```

## Prerequisites

Before starting, confirm these base conditions:

- Hermes is installed and uses `~/.hermes/config.yaml` and `~/.hermes/hooks/` for runtime configuration and custom hooks.
- OpenClaw is running locally with gateway auth enabled; the current config shows a loopback bind on port `18789` with token authentication.
- The Express task-worker is running locally, typically on `127.0.0.1:9000`.
- Shared secrets are generated and stored in environment variables or `.env` files rather than hardcoded in source code.

## Step 1: Update Hermes config

Edit `~/.hermes/config.yaml` and make sure Hermes allows local HTTP targets, because the default config shown earlier had `security.allow_private_urls: false`.

Use a block like this:

```yaml
security:
  allow_private_urls: true
  redact_secrets: true
  tirith_enabled: true
  tirith_path: tirith
  tirith_timeout: 5
  tirith_fail_open: true

hooks_auto_accept: true

platforms:
  webhook:
    enabled: true
    extra:
      port: 8644
      secret: "global-fallback-secret"
      routes:
        task-worker-result:
          secret: "replace-with-worker-result-secret"
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
```

This enables Hermes webhook routing and creates a route at `http://127.0.0.1:8644/webhooks/task-worker-result`, which is where the task-worker will send final results.

## Step 2: Create the Hermes hook

Create this directory:

```bash
mkdir -p ~/.hermes/hooks/task-worker-dispatch
```

Inside it, create `HOOK.yaml`:

```yaml
name: task-worker-dispatch
description: Send completed delegated child results to the local task-worker
events:
  - subagent_stop
```

Hermes gateway hooks are installed under `~/.hermes/hooks/` and use `HOOK.yaml` plus `handler.py` to react to supported gateway events.

## Step 3: Add the Hermes hook handler

Create `~/.hermes/hooks/task-worker-dispatch/handler.py`:

```python
import os
import json
import hashlib
import hmac
import httpx
from datetime import datetime

TASK_WORKER_URL = os.getenv("TASK_WORKER_URL", "http://127.0.0.1:9000/task")
TASK_WORKER_SECRET = os.getenv("TASK_WORKER_SECRET", "")

def _sign(body: bytes, secret: str) -> str | None:
    if not secret:
        return None
    digest = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    return f"sha256={digest}"

async def handle(event_type: str, context: dict):
    payload = {
        "task_id": context.get("parent_session_id"),
        "goal": context.get("child_role") or "delegated_task",
        "context": {
            "source_event": event_type,
            "parent_session_id": context.get("parent_session_id"),
            "child_role": context.get("child_role"),
            "child_status": context.get("child_status"),
            "duration_ms": context.get("duration_ms"),
            "emitted_at": datetime.utcnow().isoformat() + "Z"
        },
        "constraints": {
            "timeout_sec": 600,
            "tools_allowed": []
        },
        "expected_output": {
            "format": "json"
        },
        "result_hint": {
            "summary": context.get("child_summary"),
            "status": context.get("child_status")
        }
    }

    body = json.dumps(payload).encode("utf-8")
    headers = {
        "content-type": "application/json",
        "x-request-id": context.get("parent_session_id", ""),
    }

    signature = _sign(body, TASK_WORKER_SECRET)
    if signature:
        headers["x-hermes-signature"] = signature

    async with httpx.AsyncClient(timeout=10.0) as client:
        await client.post(TASK_WORKER_URL, content=body, headers=headers)
```

This handler signs the payload with a shared HMAC secret and POSTs the body to the worker’s `/task` endpoint, which matches the worker-side signature verification model already implemented in Express.

## Step 4: Configure the task-worker `.env`

In the root of the Express task-worker project, create a `.env` file with values like these:

```env
HOST=127.0.0.1
PORT=9000
AGENT_NAME=openclaw-task-worker

HERMES_SECRET=replace-with-shared-secret-from-hermes-hook
OPENCLAW_SECRET=replace-with-secret-openclaw-uses-when-calling-result

OPENCLAW_URL=http://127.0.0.1:18789/your/openclaw/endpoint
OPENCLAW_API_KEY=replace-with-your-openclaw-gateway-token

HERMES_WEBHOOK_URL=http://127.0.0.1:8644/webhooks/task-worker-result
HERMES_WEBHOOK_SECRET=replace-with-worker-result-route-secret
```

Node/Express commonly loads `.env` values into `process.env` using the `dotenv` package, and `.env` uses simple `KEY=value` lines.

Also add this at the top of the Express server file:

```js
require("dotenv").config();
```

## Step 5: Install dotenv in the task-worker

From the task-worker project directory, run:

```bash
npm install dotenv
```

This lets the worker load the `.env` file automatically when `require("dotenv").config()` is called at startup.

## Step 6: Keep the worker endpoints aligned

The task-worker should expose these endpoints:

- `POST /task` for Hermes to submit delegated work.
- `POST /result` for OpenClaw to send results back.

The worker should verify `x-hermes-signature` on `/task` using `HERMES_SECRET`, and verify `x-openclaw-signature` on `/result` using `OPENCLAW_SECRET`. HMAC verification using a shared secret and the raw request body is standard webhook security practice.

## Step 7: Use the revised `forwardToHermes()`

In the task-worker, use this function body to relay results into Hermes:

```js
async function forwardToHermes(envelope) {
  const hermesUrl =
    process.env.HERMES_WEBHOOK_URL ||
    "http://127.0.0.1:8644/webhooks/task-worker-result";

  const hermesSecret = process.env.HERMES_WEBHOOK_SECRET || "";

  const body = JSON.stringify({
    task_id: envelope.task_id,
    conversation_id: envelope.conversation_id,
    status: envelope.status || "ok",
    summary: envelope.summary || "OpenClaw completed the delegated task",
    details: envelope.details || {},
    error: envelope.error ?? null
  });

  const headers = {
    "content-type": "application/json",
    "x-request-id": envelope.trace_id || envelope.task_id || crypto.randomUUID()
  };

  if (hermesSecret) {
    const digest = crypto
      .createHmac("sha256", hermesSecret)
      .update(body)
      .digest("hex");
    headers["x-webhook-signature"] = digest;
  }

  const response = await fetch(hermesUrl, {
    method: "POST",
    headers,
    body
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Hermes forward failed with status ${response.status}: ${text}`);
  }

  return await response.json().catch(() => ({ ok: true }));
}
```

This function posts to the Hermes route created in Step 1 and signs the request with the route secret when one is configured.

## Step 8: Update OpenClaw config

The OpenClaw config already has the local gateway pieces needed by the worker: loopback bind, port `18789`, and token auth.

The main cleanup is to disable Telegram if the worker is replacing it as transport:

```json
"channels": {
  "telegram": {
    "enabled": false
  }
}
```

That keeps OpenClaw’s local gateway while removing the old Telegram ingress path.

## Step 9: Generate and store secrets

`HERMES_SECRET` and `OPENCLAW_SECRET` are arbitrary shared HMAC keys, but they should be strong random values rather than hand-written strings. A standard way to generate them is with Node’s built-in crypto or OpenSSL.

Examples:

```bash
node -e "console.log('HERMES_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log('OPENCLAW_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"
```

These values should be stored in `.env` files or another secret store, not committed into source control.

## Step 10: Restart services

After changing Hermes config, adding the hook directory, and updating environment variables, restart Hermes so it reloads the webhook platform config and discovers hooks from `~/.hermes/hooks/` during startup.

Then restart the task-worker so it loads the new `.env` values and forwarding settings.

## Step 11: Smoke test the wiring

A simple validation sequence is:

1. Start Hermes.
2. Start the task-worker.
3. Confirm OpenClaw is listening locally on `127.0.0.1:18789`.
4. Trigger a delegated flow in Hermes.
5. Confirm Hermes posts to `/task`.
6. Confirm the worker forwards to OpenClaw.
7. Confirm OpenClaw posts back to `/result`.
8. Confirm the worker posts the final payload to `http://127.0.0.1:8644/webhooks/task-worker-result`.

Useful checks:

```bash
curl http://127.0.0.1:9000/
curl http://127.0.0.1:8644/health
ss -ltnp | grep -E '9000|8644|18789'
```

The exact health endpoint available on Hermes may differ by build, but the webhook route should be reachable on the configured port once the platform is enabled.

## Notes and caveats

The in-memory `Set` and `Map` structures in the task-worker are acceptable for local testing, but they do not survive process restarts and are not safe for multiple worker instances. For durable routing and idempotency, move them to Redis, SQLite, or Postgres.

One subtle limitation remains: the hook example shown here uses the `subagent_stop` event, which Hermes documents as a delegated child completion event. That makes it appropriate for shipping delegated-child outcomes, but if the goal is to emit the initial task before the child runs, a different trigger path may be more appropriate depending on how delegation is invoked in the Hermes workflow.
