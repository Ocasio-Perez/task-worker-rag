# Hermes Slash Commands

Hermes documents slash commands as a plugin feature via
`ctx.register_command()`. This repo's `task-worker-code-tools` plugin registers
two deterministic slash commands in addition to the LLM-callable tools:

- `/code-status`
- `/code-repos`
- `/code-sync`
- `/code-read`
- `/code-search`

These commands work in Hermes CLI and gateway sessions without relying on the
model to emit a structured tool call.

## Install

Install the plugin on the WSL machine where Hermes runs:

```bash
cd ~/Development/task-worker-rag
mkdir -p ~/.hermes/plugins/task-worker-code-tools
cp -R integrations/hermes/plugins/task-worker-code-tools/* \
  ~/.hermes/plugins/task-worker-code-tools/
```

Enable it in `~/.hermes/config.yaml`:

```yaml
plugins:
  enabled:
    - task-worker-code-tools
```

Restart Hermes:

```bash
systemctl --user restart hermes-gateway.service
```

## Usage

Show integration status:

```text
/code-status
```

List indexed-corpus repos:

```text
/code-repos
```

Sync a git-backed repo mirror:

```text
/code-sync task-worker-rag
```

`/code-sync` updates the repo mirror only. Reindex from the task-worker repo
after sync:

```bash
npm run index-codebase -- task-worker-rag
```

Read a file from an indexed local repo:

```text
/code-read hello-world index.js
```

Search an indexed local repo:

```text
/code-search hello-world "Hello world" 5
```

Arguments:

- `/code-status`
- `/code-repos`
- `/code-sync <repo_name>`
- `/code-read <repo_name> <relative_path> [max_bytes]`
- `/code-search <repo_name> <query> [n_results]`

`repo_name` is the directory name under `REPO_ROOT`, usually
`~/.hermes/repos/<repo_name>`.

## Relationship To Tools

The plugin also registers LLM-callable tools:

- `code_search`
- `code_read_file`

Use the slash commands when local models do not reliably emit structured tool
calls. Use the tools when the active model/provider supports Hermes tool calling
correctly.

## Current Local Model Guidance

Local Ollama models tested through Hermes' custom OpenAI-compatible provider
were able to read tool descriptions, but did not reliably complete the full
structured tool loop. Observed failures included:

- printing function-call-like markup instead of executing the tool
- explaining how to call a tool instead of calling it
- executing a tool, then summarizing or inventing follow-up calls from the result

For local-only operation, prefer `/code-read` and `/code-search` as the reliable
workflow. Keep `code_search` and `code_read_file` enabled for future
model/provider combinations that correctly support Hermes structured tool calls.
