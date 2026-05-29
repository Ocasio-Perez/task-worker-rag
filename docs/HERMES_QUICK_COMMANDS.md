# Hermes Quick Commands

These wrappers provide deterministic local code inspection without relying on
model-native tool calling.

They call the same signed task-worker endpoints as the Hermes plugin, through
the repo's npm CLIs:

- `code-read.sh`
- `code-search.sh`

## Install

On the WSL machine where Hermes runs:

```bash
cd ~/Development/task-worker-rag
mkdir -p ~/.hermes/quick-commands
cp integrations/hermes/quick-commands/code-read.sh ~/.hermes/quick-commands/code-read
cp integrations/hermes/quick-commands/code-search.sh ~/.hermes/quick-commands/code-search
chmod +x ~/.hermes/quick-commands/code-read ~/.hermes/quick-commands/code-search
```

If the repo is not at `~/Development/task-worker-rag`, set
`TASK_WORKER_RAG_DIR` in the Hermes service environment.

## Direct Smoke Tests

```bash
~/.hermes/quick-commands/code-read hello-world index.js
~/.hermes/quick-commands/code-search hello-world "Hello world" 5
```

## Hermes Config

Wire the scripts into Hermes quick commands using the quick-command shape your
installed Hermes version supports. The intended command mappings are:

```yaml
quick_commands:
  code-read:
    command: ~/.hermes/quick-commands/code-read
    description: Read a file from an indexed local repo.
  code-search:
    command: ~/.hermes/quick-commands/code-search
    description: Search an indexed local repo.
```

Usage:

```text
/code-read hello-world index.js
/code-search hello-world "Hello world" 5
```

These commands are local-only and deterministic. They do not depend on the model
emitting a structured function/tool call.
