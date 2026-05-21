### 6.3 task-worker returns `task_processing_failed` (500)

Causes:

- task-worker’s call to OpenClaw failed (network, wrong URL, bad token).
- task-worker’s call back to Hermes failed (wrong webhook URL, wrong secret, route not configured).
- An uncaught exception in the request handler.

Checks:

```bash
journalctl --user -u task-worker -n 200 --no-pager | tail -n 80
```

Look for:

- `forwardToOpenClaw failed status=...` → OpenClaw side issue.
- `Hermes forward failed with status ...` → outbound webhook to Hermes failed.
- Any stack trace not matching the above → unexpected app bug.

Fixes:

- Confirm OpenClaw direct call works (see §4.2). If it fails, see §6.4.
- Confirm Hermes inbound works (see §4.3 and §6.2).
- Verify env values inside the running task-worker process:
  ```bash
  PID=$(pgrep -af 'node task-worker.js' | awk '{print $1}')
  tr '\0' '\n' < /proc/$PID/environ | grep -E "OPENCLAW|HERMES_WEBHOOK"
  ```

### 6.4 OpenClaw direct call fails

Symptoms:

- `Connection refused` → OpenClaw not running.
- `401` → bad `OPENCLAW_API_KEY`.
- `404` → wrong URL/path (must be `/v1/chat/completions`).
- `5xx` → OpenClaw internal failure.

Checks:

```bash
systemctl --user status openclaw-gateway --no-pager
journalctl --user -u openclaw-gateway -n 200 --no-pager
ss -ltnp | grep -E '18789|18791'
```

Fixes:

- If unit is failed:
  ```bash
  systemctl --user reset-failed openclaw-gateway
  systemctl --user restart openclaw-gateway
  ```
- If key is wrong, verify env:
  ```bash
  PID=$(systemctl --user show openclaw-gateway.service --property=MainPID --value)
  tr '\0' '\n' < /proc/$PID/environ | grep -i openclaw
  ```

### 6.5 Hermes returns `202 Accepted` but “nothing happens”

This is by design: the webhook is non-blocking.

Checks:

```bash
journalctl --user -u hermes-gateway -n 200 --no-pager
```

Look for:

- `[webhook] POST event=... route=external-delegation prompt_len=... delivery=<id>` → request was queued.
- Subsequent agent / Ollama / tool-use lines → subagent ran.
- `subagent_stop` and `task-worker-dispatch` lines → hook fired downstream.

Common findings:

- Subagent loops on “Unknown tool …” and exits as `partial`. This is the known model/toolset mismatch documented in `README.md`. The HTTP transport is fine; this is a Hermes runtime issue.

### 6.6 `Connection refused` from curl

Means there’s no listener at all on the target host:port.

Checks:

```bash
ss -ltnp | grep -E '8644|9000|18789'
```

If a port is missing:

```bash
systemctl --user status <unit>
journalctl --user -u <unit> -n 200 --no-pager
```

Common reasons:

- Service crashed and exceeded `StartLimitBurst` (see §6.10).
- Wrong port in `ExecStart` or env.
- Another process bound the port; check with:
  ```bash
  ss -ltnp | grep ':<port>'
  ```

### 6.7 `URL rejected: Malformed input to a URL function` from curl

Means the URL string passed to `curl` is empty or contains stray characters.

Check:

```bash
printf 'URL=[%s]\n' "$YOUR_URL_VAR"
```

If the brackets contain quotes, newlines, or are empty, fix the variable:

```bash
export YOUR_URL_VAR=http://127.0.0.1:9000/task
```

Make sure env files don’t wrap values in quotes; systemd `EnvironmentFile=` does **not** strip surrounding quotes.

### 6.8 Hermes env not actually applied

`systemctl show` can lie about effective env in some cases. The definitive source is `/proc/PID/environ`.

```bash
PID=$(systemctl --user show hermes-gateway.service --property=MainPID --value)
tr '\0' '\n' < /proc/$PID/environ | sort
```

If a variable is missing, ensure:

- It is in `~/.config/systemd/user/hermes-gateway.env` (no surrounding quotes).
- The unit has `EnvironmentFile=...` pointing there (directly, or via a drop-in at `~/.config/systemd/user/hermes-gateway.service.d/env.conf`).
- Reload + restart:
  ```bash
  systemctl --user daemon-reload
  systemctl --user restart hermes-gateway
  ```

### 6.9 Code-memory `/api/search-codebase` returns stale or weird results

Causes:

- The repo was indexed before file-filtering changes (so old chunks like `package-lock.json` linger).
- Wrong `REPO_ROOT` / `repo_name` for the corpus you intended to search.

Fixes:

```bash
# From the runtime repo
node scripts/cleanup-repo-index.js <repo_name>
node scripts/reindex-codebase.js <repo_name>
```

Then re-query `/api/search-codebase` with the same `repo_name`.

### 6.10 Service in `failed` state and won’t restart

If you see “start request repeated too quickly” or similar:

```bash
systemctl --user reset-failed <unit>
systemctl --user start <unit>
journalctl --user -u <unit> -n 100 --no-pager
```

If it keeps failing, run the underlying command in the foreground to see the real error:

```bash
# Example: OpenClaw
/home/larry/.nvm/versions/node/v22.22.2/bin/openclaw gateway --port 18789

# Example: task-worker
cd ~/Development/task-worker-rag
node task-worker.js
```

Fix the root cause, then `systemctl --user start <unit>` again.

---

## 7. Routine maintenance

### Update task-worker code

```bash
cd ~/Development/task-worker-rag
git pull
# If deps changed:
npm install
systemctl --user restart task-worker
journalctl --user -u task-worker -f
```

### Update Hermes config

```bash
$EDITOR /home/larry/.hermes/config.yaml
# validate first
python3 -c "import yaml; yaml.safe_load(open('/home/larry/.hermes/config.yaml')); print('OK')"
systemctl --user restart hermes-gateway
journalctl --user -u hermes-gateway -f
```

### Update a Hermes hook

```bash
$EDITOR /home/larry/.hermes/hooks/task-worker-dispatch/HOOK.yaml
systemctl --user restart hermes-gateway
journalctl --user -u hermes-gateway -n 50 --no-pager | grep -i hook
```

### Rotate secrets

When changing `TASK_WORKER_SECRET` / `HERMES_SECRET` or the `external-delegation` route secret:

1. Update both ends to the **same** new value (Hermes env and task-worker env).
2. Reload + restart both:
   ```bash
   systemctl --user daemon-reload
   systemctl --user restart hermes-gateway task-worker
   ```
3. Re-run §4.1 and §4.3 to confirm.

### Rebuild code memory

```bash
cd ~/Development/task-worker-rag
node scripts/cleanup-repo-index.js <repo_name>
node scripts/reindex-codebase.js <repo_name>
```

---

## 8. Useful one-liners

```bash
# Show every user service that is active
systemctl --user list-units --type=service --state=active

# Show recent failures across user units
systemctl --user --failed

# Pretty-print env for a running service
PID=$(systemctl --user show <unit>.service --property=MainPID --value)
tr '\0' '\n' < /proc/$PID/environ | sort

# Find what owns a port
ss -ltnp | grep ':<port>'
pgrep -af '<binary>'

# Last 30 minutes of logs for one unit
journalctl --user -u <unit> --since "30 min ago" --no-pager
```

---

## 9. Quick reference (cheat sheet)

```bash
# Health
ss -ltnp | grep -E '8644|9000|18789'
curl -s http://127.0.0.1:9000/ ; echo
./scripts/hermes-inbound-test.sh

# Restart everything
systemctl --user restart openclaw-gateway task-worker hermes-gateway

# Tail all relevant logs in three terminals
journalctl --user -u openclaw-gateway -f
journalctl --user -u task-worker -f
journalctl --user -u hermes-gateway -f
```

If any of these fail, jump to the matching section in §6.

## 10. Automated health check (`scripts/healthcheck.sh`)

A small script that runs the §3 checks and exits non-zero on the first failure.

### Usage

```bash
./scripts/healthcheck.sh            # human-readable
./scripts/healthcheck.sh --quiet    # only print failures + final status
./scripts/healthcheck.sh --json     # machine-readable summary
```

### What it checks

- TCP listeners on Hermes (`8644`), task-worker (`9000`), OpenClaw (`18789`).
- task-worker `GET /` returns `Server is running`.
- OpenClaw `GET /` is reachable (2xx/3xx, or 401/403 from an auth-gated root still counts as alive).
- Signed inbound delivery to Hermes via `hermes-inbound-test.sh`, expecting `202 Accepted` with a `delivery_id`.

### Defaults and overrides

Connection targets default to localhost on the standard ports, and the inbound script is auto-resolved in this order:

1. `$HERMES_INBOUND_SCRIPT` (explicit override)
2. `./scripts/hermes-inbound-test.sh`
3. `~/.hermes/scripts/hermes-inbound-test.sh`
4. `~/Development/task-worker-rag/scripts/hermes-inbound-test.sh`

You can override any of these via env, for example:

```bash
TASK_WORKER_PORT=9000 \
HERMES_INBOUND_SCRIPT=/home/larry/.hermes/scripts/hermes-inbound-test.sh \
  ./scripts/healthcheck.sh
```

### Use it before/after restarts

```bash
systemctl --user restart task-worker
./scripts/healthcheck.sh
```

### Use it in cron or as a systemd timer

`~/.config/systemd/user/stack-healthcheck.service`:

```ini
[Unit]
Description=Stack healthcheck (Hermes + task-worker + OpenClaw)

[Service]
Type=oneshot
WorkingDirectory=/home/larry/Development/task-worker-rag
ExecStart=/home/larry/Development/task-worker-rag/scripts/healthcheck.sh --quiet
```

`~/.config/systemd/user/stack-healthcheck.timer`:

```ini
[Unit]
Description=Run stack healthcheck every 5 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
AccuracySec=30s
Persistent=true

[Install]
WantedBy=timers.target
```

Enable it:

```bash
systemctl --user daemon-reload
systemctl --user enable --now stack-healthcheck.timer
journalctl --user -u stack-healthcheck.service -f
```

### Interpreting output

- All `OK` lines + `All checks passed.` → the stack is healthy.
- Any `FAIL` line names the failing check (e.g. `listener:hermes`, `task-worker:/`, `hermes:inbound`). Jump to the matching section in §6 to debug:
  - listener failures → §6.6 (`Connection refused`)
  - task-worker root failures → §6.3 / §6.6
  - OpenClaw failures → §6.4
  - Hermes inbound failures → §6.2 (`Invalid signature for route external-delegation`)

### Exit codes

- `0` – all checks passed.
- `1` – one or more checks failed.
- `2` – invalid argument to the script.