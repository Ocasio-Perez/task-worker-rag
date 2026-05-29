# Hermes Slash Commands

Hermes documents slash commands as a plugin feature via
`ctx.register_command()`. This repo's `task-worker-code-tools` plugin registers
two deterministic slash commands in addition to the LLM-callable tools:

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

Read a file from an indexed local repo:

```text
/code-read hello-world index.js
```

Search an indexed local repo:

```text
/code-search hello-world "Hello world" 5
```

Arguments:

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
