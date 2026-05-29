# Hermes Code Tools Plugin

This repo includes a Hermes plugin that registers collision-safe code tools:

- `code_search`
- `code_read_file`

It also registers deterministic Hermes slash commands:

- `/code-status`
- `/code-help`
- `/code-repos`
- `/code-sync`
- `/code-search`
- `/code-read`

The plugin is intentionally thin. It only signs JSON requests and forwards them
to task-worker-rag's HTTP endpoints.

The handlers accept both Hermes call shapes: a single params dictionary and
keyword-style tool arguments.

They also tolerate common model-selected aliases:

- `path: /home/larry/.hermes/repos/<repo>` can be used instead of `repo_name`
  for search.
- `max_results` can be used instead of `n_results`.
- `file`, `filename`, or a repo-contained `path` can be used instead of
  `relative_path` for read-file.

`code_read_file` returns a minimal JSON payload with only `ok` and `content` on
successful reads so agents can echo source exactly without extra metadata. Error
responses remain structured JSON.

## Install

On the WSL machine where Hermes runs:

```bash
cd ~/Development/task-worker-rag
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

If `plugins.enabled` already exists, append `task-worker-code-tools` to the
existing list.

## Environment

Hermes needs the same code-search secret as task-worker:

```env
CODE_SEARCH_URL=http://127.0.0.1:9000/api/search-codebase
CODE_READ_FILE_URL=http://127.0.0.1:9000/api/read-file
CODE_SEARCH_HMAC_SECRET=<same secret task-worker uses>
```

To debug Hermes argument shapes, temporarily add:

```env
TASK_WORKER_CODE_TOOLS_DEBUG=1
```

This prints plugin handler inputs and outgoing task-worker request bodies to the
Hermes logs. It does not print the HMAC secret.

If Hermes runs through systemd, put those values in the Hermes environment file
and restart:

```bash
systemctl --user daemon-reload
systemctl --user restart hermes-gateway.service
```

## Smoke Test

Ask Hermes:

```text
Use the code_search tool to inspect repo hello-world. Find where Hello world is
logged. Then use code_read_file on the exact file returned by search and answer
with the file path and snippet.
```

Expected final answer:

```text
hello-world/index.js contains:
console.log("Hello world");
```

## Slash Commands

For local models that do not reliably emit structured tool calls, use the
plugin's Hermes-native slash commands:

```text
/code-status
/code-help
/code-repos
/code-sync task-worker-rag
/code-read hello-world index.js
/code-search hello-world "Hello world" 5
```

See `docs/HERMES_SLASH_COMMANDS.md` for details.
