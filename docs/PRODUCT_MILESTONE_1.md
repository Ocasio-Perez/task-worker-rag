# Product Milestone 1: Install And Status

This milestone turns the Hermes code-memory integration into a repeatable local
developer-tool workflow.

## What This Provides

- install/update script for the Hermes plugin
- Hermes-native slash commands:
  - `/code-status`
  - `/code-read`
  - `/code-search`
- task-worker systemd unit and env templates
- shared env template
- operator status command:
  - `npm run code-status`

## Install Or Update Hermes Integration

On the WSL machine where Hermes runs:

```bash
cd ~/Development/task-worker-rag
git pull --ff-only origin main
npm install

./scripts/install-hermes-integration.sh --restart-hermes
```

If installing the task-worker systemd unit for the first time:

```bash
./scripts/install-hermes-integration.sh --with-systemd --restart-hermes
```

Then edit:

```text
~/.config/systemd/user/task-worker-rag.env
```

Set real values for:

- `CODE_SEARCH_HMAC_SECRET`
- `HERMES_SECRET`
- `OPENCLAW_SECRET`

Enable/start task-worker:

```bash
systemctl --user daemon-reload
systemctl --user enable --now task-worker-rag.service
```

## Hermes Config

Ensure `~/.hermes/config.yaml` enables the plugin:

```yaml
plugins:
  enabled:
    - task-worker-code-tools
```

Ensure the Hermes gateway environment has the same
`CODE_SEARCH_HMAC_SECRET` as task-worker. See:

```text
deploy/systemd/hermes-code-tools.env.example
```

Restart Hermes after changing plugin files or environment:

```bash
systemctl --user restart hermes-gateway.service
```

## Status Checks

Operator status from the repo:

```bash
cd ~/Development/task-worker-rag
npm run code-status
npm run code-status -- hello-world
npm run code-status -- hello-world --json
```

Hermes status:

```text
/code-status
```

The repo-level status checks:

- task-worker `/health`
- Ollama `/api/tags`
- ChromaDB heartbeat
- `REPO_ROOT`
- optional repo directory
- optional indexed chunk count for a repo

## Daily Use

Read exact file content:

```text
/code-read hello-world index.js
```

Search indexed repo chunks:

```text
/code-search hello-world "Hello world" 5
```

After meaningful code changes in a mirrored repo:

```bash
cd ~/.hermes/repos/<repo_name>
git pull --ff-only

cd ~/Development/task-worker-rag
npm run index-codebase -- <repo_name>
npm run code-status -- <repo_name>
```

## Why Slash Commands Are The Local Default

The plugin still exposes LLM-callable tools (`code_search` and
`code_read_file`). Those are the clean model-tool path when a model/provider
reliably supports Hermes structured tool calling.

For the current local-only Ollama workflow, slash commands are the dependable
path because Hermes executes them directly through the documented plugin command
API.
