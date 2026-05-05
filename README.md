# Hermes + task-worker + OpenClaw Wiring Guide

This guide documents the final working wiring for Hermes, task-worker, and OpenClaw using HTTP instead of Telegram as the inter-agent transport.

## Topology

The final flow is:

```text
Hermes hook -> task-worker /task -> OpenClaw /v1/chat/completions -> task-worker -> Hermes webhook
```

Hermes sends delegated work to the task-worker over a signed HTTP request, the task-worker forwards the task to the local OpenClaw gateway, and the task-worker then relays the resulting completion back into Hermes through a signed webhook route.

## Working ports and services

The working local endpoints are:

- Hermes webhook listener: `http://127.0.0.1:8644`
- task-worker: `http://127.0.0.1:9000`
- OpenClaw gateway: `http://127.0.0.1:18789` with token auth enabled

OpenClaw was verified to accept `POST /v1/chat/completions` with Bearer token authentication and return a standard chat completion response.

## Hermes configuration

Hermes must expose a webhook route so the task-worker can post results back into the gateway. The route is configured under top-level `platforms.webhook`, and the working callback route name is `task-worker-result`.

A working shape is:

```yaml
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
```

Hermes was also configured with `security.allow_private_urls: true`, which is required for local webhook and task routing in this setup.

## Hermes hook

The Hermes hook signs outbound requests to the task-worker using HMAC SHA-256 with the `TASK_WORKER_SECRET` environment variable. It sends the signature in `x-hermes-signature` and posts the exact JSON bytes it signed.

A working handler shape is:

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

## task-worker `.env`

The final task-worker environment is:

```env
AGENT_NAME=Claw
HOST=127.0.0.1
PORT=9000

HERMES_SECRET=<same value as TASK_WORKER_SECRET in Hermes>
OPENCLAW_SECRET=<shared secret for /result verification if OpenClaw signs callbacks>

OPENCLAW_URL=http://127.0.0.1:18789/v1/chat/completions
OPENCLAW_API_KEY=<OpenClaw gateway token>

HERMES_WEBHOOK_URL=http://127.0.0.1:8644/webhooks/task-worker-result
HERMES_WEBHOOK_SECRET=<same value as Hermes webhook route secret>
```

The critical secret pair is:

- Hermes `TASK_WORKER_SECRET`
- task-worker `HERMES_SECRET`

Those two values must be identical or `/task` returns `bad_signature`.

## task-worker server

The task-worker exposes two HTTP endpoints:

- `POST /task`: receives signed delegated work from Hermes
- `POST /result`: receives signed result callbacks from OpenClaw, if callback mode is used

The working implementation uses raw-body HMAC verification, stores task routing state in memory, forwards accepted tasks to OpenClaw, and relays results back to Hermes.

A working `forwardToOpenClaw` implementation uses OpenClaw's OpenAI-compatible chat completions endpoint:

```js
async function forwardToOpenClaw(envelope) {
  const url = process.env.OPENCLAW_URL || "http://127.0.0.1:18789/v1/chat/completions";
  const apiKey = process.env.OPENCLAW_API_KEY || "";

  if (!apiKey) {
    throw new Error("OPENCLAW_API_KEY is not set");
  }

  const body = JSON.stringify({
    model: "openclaw/default",
    messages: [
      {
        role: "system",
        content:
          "You are OpenClaw receiving a delegated task from Hermes through task-worker. " +
          "Read the provided JSON payload, execute the task, and respond concisely.",
      },
      {
        role: "user",
        content: JSON.stringify({
          task_id: envelope.task_id,
          conversation_id: envelope.conversation_id,
          goal: envelope.goal,
          context: envelope.context,
          constraints: envelope.constraints,
          expected_output: envelope.expected_output,
          metadata: {
            trace_id: envelope.trace_id,
            received_at: envelope.received_at,
          },
        }),
      },
    ],
    stream: false,
  });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`OpenClaw forward failed with status ${response.status}: ${text}`);
  }

  const json = await response.json().catch(() => ({ ok: true }));
  const completionText = json?.choices?.[0]?.message?.content || "OpenClaw completed the delegated task";

  await forwardToHermes({
    task_id: envelope.task_id,
    conversation_id: envelope.conversation_id,
    status: "ok",
    summary: "OpenClaw completed the delegated task",
    details: {
      openclaw_response: completionText,
      raw_openclaw: json,
    },
    error: null,
    trace_id: envelope.trace_id,
  });

  return json;
}
```

## systemd environment fix

A major issue during setup was that Hermes `.env` values were not automatically visible to the `hermes-gateway` systemd user service. The definitive check was reading the running process environment from `/proc/$PID/environ`, not relying only on `systemctl show ... --property=Environment`.

The working fix was:

1. Create `~/.config/systemd/user/hermes-gateway.env` with the required `TASK_WORKER_*` and `HERMES_WEBHOOK_*` values.
2. Create `~/.config/systemd/user/hermes-gateway.service.d/env.conf` with:

```ini
[Service]
EnvironmentFile=/home/larry/.config/systemd/user/hermes-gateway.env
```

3. Reload and restart:

```bash
systemctl --user daemon-reload
systemctl --user restart hermes-gateway
```

4. Verify the running process environment:

```bash
PID=$(systemctl --user show hermes-gateway.service --property=MainPID --value)
tr '\0' '\n' < /proc/$PID/environ | grep -E 'TASK_WORKER|HERMES_WEBHOOK'
```

That final `/proc` check confirmed Hermes was actually running with the expected secrets and URLs.

## Verification steps

### 1. Verify listeners

```bash
ss -ltnp | grep -E '8644|9000|18789'
curl http://127.0.0.1:9000/
curl http://127.0.0.1:8644/health
```

The working state is Hermes on `8644`, task-worker on `9000`, and OpenClaw on `18789`.

### 2. Verify Hermes webhook route

A signed POST to Hermes webhook was accepted with:

```json
{"status":"accepted","route":"task-worker-result","event":"unknown","delivery_id":"..."}
```

That confirmed the task-worker can relay results back into Hermes through the configured route.

### 3. Verify OpenClaw directly

The correct OpenClaw endpoint was verified with:

```bash
curl -v http://127.0.0.1:18789/v1/chat/completions \
  -H "Authorization: Bearer <OPENCLAW_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openclaw/default",
    "messages": [
      { "role": "user", "content": "Hello from direct OpenClaw test" }
    ],
    "stream": false
  }'
```

OpenClaw returned a standard chat completion response with `choices[0].message.content`, which confirmed the endpoint and token were correct.

### 4. Verify task-worker `/task`

The final signed curl for Hermes-style ingress was:

```bash
SECRET='<TASK_WORKER_SECRET>'

BODY='{
  "task_id": "test-forward-openclaw",
  "goal": "Test Hermes -> task-worker -> OpenClaw -> Hermes round-trip",
  "context": {
    "source_event": "manual_test",
    "parent_session_id": "manual-session",
    "child_role": "tester",
    "child_status": "ok",
    "duration_ms": 1234,
    "emitted_at": "2026-05-05T16:47:00Z"
  },
  "constraints": {
    "timeout_sec": 600,
    "tools_allowed": []
  },
  "expected_output": {
    "format": "json"
  },
  "result_hint": {
    "summary": "Manual forward-to-openclaw test",
    "status": "ok"
  }
}'

DIGEST=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | sed 's/^.* //')
SIG="sha256=$DIGEST"

curl -v http://127.0.0.1:9000/task \
  -H "content-type: application/json" \
  -H "x-hermes-signature: $SIG" \
  -H "x-request-id: manual-openclaw-test-2" \
  -d "$BODY"
```

The working response was `HTTP/1.1 202 Accepted`, confirming Hermes-signature verification, task acceptance, and successful forward into OpenClaw.

## Final status

The final working transport is:

- Hermes hook signs and sends tasks to task-worker `/task`
- task-worker verifies HMAC and forwards the task to OpenClaw `/v1/chat/completions` using Bearer token auth
- task-worker extracts the completion text from `choices[0].message.content` and posts the result back to Hermes via `task-worker-result` webhook

This replaces Telegram as the inter-agent transport layer while keeping Hermes and OpenClaw loosely coupled through a simple HTTP broker.
